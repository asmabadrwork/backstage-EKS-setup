# Spotify Backstage - Production Deployment on AWS EKS

This repository contains the enterprise-grade production setup for the **Spotify Backstage Developer Portal** deployed on **AWS Elastic Kubernetes Service (EKS)** with **Amazon RDS PostgreSQL (Multi-AZ)**, **AWS Secrets Manager**, **External Secrets Operator (ESO)**, **Amazon ECR**, and **Nginx Ingress with TLS encryption**.

---

##  Production Architecture & Technology Stack

```
[ Users & Developers ]
         │ (HTTPS / 443)
         ▼
[ DNS (Hostinger / Route 53) ]
         │ (CNAME: backstage.tyagi.fun)
         ▼
[ AWS Network Load Balancer (NLB) ]
         │
         ▼
[ Nginx Ingress Controller (ZeroSSL TLS Termination) ]
         │ (HTTP / 7007)
         ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Amazon EKS Cluster (Kubernetes 1.32 - Multi-AZ: ap-south-1a, 1b, 1c)    │
│                                                                        │
│  [ Backstage Deployment ] ◄──► [ Horizontal Pod Autoscaler (HPA) ]     │
│   ├── Pod 1 (AZ-a)             [ Pod Disruption Budget (minAvailable=2)│
│   ├── Pod 2 (AZ-b)                                                     │
│   └── Pod 3 (AZ-c)                                                     │
│                                                                        │
│  [ External Secrets Operator (ESO v1) ]                                │
│   └── SecretStore (IRSA) ◄──► AWS Secrets Manager ("production/backstage")│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    │ (Encrypted TLS / Port 5432)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Amazon RDS for PostgreSQL (Multi-AZ with Automatic Failover)           │
│   ├── Primary Writer (AZ-a)                                            │
│   └── Synchronous Standby Replica (AZ-b / AZ-c)                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Core Technologies
- **Application**: Spotify Backstage v1.x (Unified Frontend React UI + Node.js Backend)
- **Runtime**: Node.js 22 LTS & Yarn Berry Monorepo
- **Kubernetes**: AWS EKS v1.32 across 3 Availability Zones (`ap-south-1a`, `ap-south-1b`, `ap-south-1c`)
- **Networking**: VPC `10.30.0.0/16` with Highly Available NAT Gateways (1 per AZ)
- **Database**: Amazon RDS for PostgreSQL (Multi-AZ, SSL encrypted)
- **Secrets Management**: AWS Secrets Manager synced via External Secrets Operator (ESO `v1`)
- **Ingress & SSL**: Nginx Ingress Controller with TLS certificate secrets
- **CI/CD**: GitHub Actions using native **AWS OIDC (Zero long-lived credentials, zero SSH bastions)**
- **Resilience**: Horizontal Pod Autoscaler (`hpa.yaml`), Pod Disruption Budget (`pdb.yaml`), and rolling updates

---

##  Repository Structure

```text
.
├── .github/workflows/
│   ├── ci.yml                 # CI: Secret scanning (Gitleaks), Type checking, Linting, Config Check
│   └── cd.yml                 # CD: Build bundle, Docker build, ECR push, and Helm deploy via AWS OIDC
├── helm/
│   └── backstage/             # Production Helm Chart
│       ├── Chart.yaml         # Chart metadata
│       ├── values.yaml        # Configurable deployment values (domain, RDS host, secrets)
│       └── templates/
│           ├── _helpers.tpl   # Template helper macros
│           ├── backstage.yaml # Deployment (HPA/HA) & ClusterIP Service
│           ├── external-secrets.yaml # ESO SecretStore & ExternalSecret (v1)
│           ├── hpa.yaml       # Horizontal Pod Autoscaler (min: 3, max: 10)
│           ├── ingress.yaml   # Nginx Ingress with TLS
│           ├── pdb.yaml       # Pod Disruption Budget (minAvailable: 2)
│           ├── postgres-secrets.yaml # DB Secret template
│           └── secrets.yaml   # App Secret template
├── packages/
│   ├── app/                   # Frontend React Single-Page Application
│   └── backend/               # Backend Node.js Service (Catalog, Scaffolder, TechDocs, Search)
├── app-config.yaml            # Base Backstage configuration
├── app-config.production.yaml # Production overrides (Dynamic URLs, RDS SSL, Guest auth)
├── catalog-info.yaml          # Root entity definition for Backstage catalog
├── Dockerfile                 # Production multi-stage Dockerfile (runs as non-root 'node')
├── eks-cluster.yaml           # eksctl Multi-AZ EKS cluster definition (v1.32)
├── package.json               # Monorepo root dependencies & scripts
└── README.md
```

---

##  Complete Setup Guide From Scratch (New EKS Cluster & New Server)

> **Important Note**: Because **GitHub Actions handles 100% of the building, containerization, and deployment**, your management server is strictly a lightweight **Infrastructure Bootstrap Machine**. You do not need to install Node.js, compile code, or store build artifacts on the server.

---

### Step 1: Provision & Setup Management Server (EC2)

Launch a clean **Ubuntu 24.04 EC2 instance** (`t3.small` or `t3.medium`) with an IAM Role granting `AdministratorAccess` (or configure AWS credentials via `aws configure`).

Run this script to install all required infrastructure tools:

```bash
#!/bin/bash
set -e
sudo apt-get update && sudo apt-get install -y curl unzip git jq ca-certificates

# 1. AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip && sudo ./aws/install && rm -rf aws awscliv2.zip

# 2. kubectl (v1.32)
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl

# 3. eksctl
ARCH=amd64
curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_$(uname -s)_$ARCH.tar.gz"
tar -xzf "eksctl_$(uname -s)_$ARCH.tar.gz" -C /tmp && sudo mv /tmp/eksctl /usr/local/bin && rm "eksctl_$(uname -s)_$ARCH.tar.gz"

# 4. Helm v3
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

echo "--- Bootstrap Server Ready ---"
aws --version && kubectl version --client && eksctl version && helm version
```

---

### Step 2: Provision Multi-AZ EKS Cluster

Clone your repository to access the cluster configuration:

```bash
git clone https://github.com/asmabadrwork/backstage-EKS-setup.git
cd backstage-EKS-setup
```

Create the EKS cluster using `eksctl`:

```bash
eksctl create cluster -f eks-cluster.yaml
```

*What this provisions:*
- Production VPC `10.30.0.0/16` with **3 High-Availability NAT Gateways** across 3 Availability Zones.
- Kubernetes 1.32 Control Plane named `backstage-production`.
- **3 worker nodes (`t3.large`)** spread across `ap-south-1a`, `ap-south-1b`, `ap-south-1c`.
- EBS CSI Driver, VPC CNI, and CoreDNS add-ons.

Configure `kubectl` access:
```bash
aws eks update-kubeconfig --name backstage-production --region ap-south-1
kubectl get nodes -o wide
```

---

### Step 3: Provision Amazon RDS PostgreSQL (Multi-AZ)

Backstage requires an external PostgreSQL database with SSL enabled.

```bash
# 1. Fetch VPC ID & Private Subnets created by eksctl
VPC_ID=$(aws eks describe-cluster --name backstage-production --query 'cluster.resourcesVpcConfig.vpcId' --output text)
SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" \
  --query "Subnets[?MapPublicIpOnLaunch==\`false\`].SubnetId" --output text | tr '\t' ' ')

# 2. Create DB Subnet Group
aws rds create-db-subnet-group \
  --db-subnet-group-name backstage-rds-subnets \
  --db-subnet-group-description "Subnet group for Backstage RDS" \
  --subnet-ids $SUBNETS \
  --region ap-south-1

# 3. Create Security Group allowing port 5432 from EKS VPC
RDS_SG_ID=$(aws ec2 create-security-group \
  --group-name backstage-rds-sg \
  --description "Allow Postgres from EKS VPC" \
  --vpc-id $VPC_ID \
  --output text --query 'GroupId')

aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG_ID \
  --protocol tcp --port 5432 \
  --cidr 10.30.0.0/16

# 4. Create Multi-AZ PostgreSQL 15 Instance
aws rds create-db-instance \
  --db-instance-identifier backstage-production-db \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.7 \
  --allocated-storage 50 \
  --storage-type gp3 \
  --master-username backstage \
  --master-user-password "YourStrongPasswordHere123!" \
  --db-subnet-group-name backstage-rds-subnets \
  --vpc-security-group-ids $RDS_SG_ID \
  --multi-az \
  --backup-retention-period 7 \
  --no-publicly-accessible \
  --region ap-south-1
```

Retrieve the RDS endpoint once available:
```bash
RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier backstage-production-db \
  --query 'DBInstances[0].Endpoint.Address' --output text)
echo "RDS Endpoint: $RDS_ENDPOINT"
```

---

### Step 4: Configure AWS Secrets Manager & External Secrets Operator (ESO)

#### 1. Store Application Secrets in AWS Secrets Manager
```bash
BACKEND_SECRET=$(openssl rand -hex 24)

aws secretsmanager create-secret \
  --name "production/backstage" \
  --description "Backstage production credentials" \
  --secret-string "{
    \"POSTGRES_HOST\": \"$RDS_ENDPOINT\",
    \"POSTGRES_PORT\": \"5432\",
    \"POSTGRES_USER\": \"backstage\",
    \"POSTGRES_PASSWORD\": \"YourStrongPasswordHere123!\",
    \"POSTGRES_DATABASE\": \"postgres\",
    \"BACKEND_SECRET\": \"$BACKEND_SECRET\",
    \"GITHUB_TOKEN\": \"ghp_yourPersonalAccessTokenHere\"
  }" \
  --region ap-south-1
```

#### 2. Install External Secrets Operator (v1)
```bash
helm repo add external-secrets https://charts.external-secrets.io
helm repo update

helm install external-secrets external-secrets/external-secrets \
  -n external-secrets \
  --create-namespace \
  --set installCRDs=true
```

---

### Step 5: Install Ingress Controller, DNS & TLS Certificate

#### 1. Install Nginx Ingress Controller
```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"="nlb"
```

#### 2. Configure DNS CNAME
Get the AWS Load Balancer hostname:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```
In your DNS provider (Hostinger, Cloudflare, Route53):
- Add a **CNAME** record:
  - **Host / Name**: `backstage` (for `backstage.tyagi.fun`)
  - **Target / Value**: The Load Balancer hostname output above.

#### 3. Deploy TLS Secret
```bash
kubectl create namespace backstage || true

# Deploy your SSL certificate chain (combined domain certificate + intermediate CA)
kubectl create secret tls backstage-tls \
  --cert=/path/to/fullchain.crt \
  --key=/path/to/private.key \
  --namespace backstage
```

---

### Step 6: Configure ECR & AWS OIDC for GitHub Actions (Zero Static Credentials)

This grants GitHub Actions permission to authenticate directly with AWS STS, build and push Docker containers to ECR, and execute Helm deployments to EKS.

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
REGION="ap-south-1"

# 1. Create Amazon ECR Repository
aws ecr create-repository \
  --repository-name backstage \
  --region $REGION \
  --image-scanning-configuration scanOnPush=true || true

# 2. Register GitHub OIDC Provider with official TLS thumbprints
aws iam create-open-id-connect-provider \
  --url "https://token.actions.githubusercontent.com" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" "1c5860a5f6ec55543956db1999d8079542a10f0e" 2>/dev/null || true

# 3. Create IAM Role with AWS-compliant scoped Trust Policy
cat <<EOF > /tmp/github-oidc-trust.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:asmabadrwork@215350865/backstage-EKS-setup@1359842655:*",
            "repo:asmabadrwork*:*",
            "repo:asmabadrwork/backstage-EKS-setup:*"
          ]
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name github-actions-backstage-cd \
  --assume-role-policy-document file:///tmp/github-oidc-trust.json

# 4. Attach ECR Push Permissions
aws iam attach-role-policy \
  --role-name github-actions-backstage-cd \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

# 5. Attach EKS Describe Permission
cat <<EOF > /tmp/eks-describe-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["eks:DescribeCluster"],
      "Resource": "arn:aws:eks:$REGION:$ACCOUNT_ID:cluster/backstage-production"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name github-actions-backstage-cd \
  --policy-name EKSDescribeCluster \
  --policy-document file:///tmp/eks-describe-policy.json

# 6. Grant Role Admin Access to EKS via Access Entries
aws eks create-access-entry \
  --cluster-name backstage-production \
  --principal-arn arn:aws:iam::$ACCOUNT_ID:role/github-actions-backstage-cd \
  --type STANDARD \
  --region $REGION

aws eks associate-access-policy \
  --cluster-name backstage-production \
  --principal-arn arn:aws:iam::$ACCOUNT_ID:role/github-actions-backstage-cd \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster \
  --region $REGION

echo "Role created: arn:aws:iam::$ACCOUNT_ID:role/github-actions-backstage-cd"
```

#### 7. Add GitHub Actions Secret
In GitHub: **Settings** ➔ **Secrets and variables** ➔ **Actions** ➔ **New repository secret**:
- **Name**: `AWS_ROLE_ARN`
- **Value**: `arn:aws:iam::<ACCOUNT_ID>:role/github-actions-backstage-cd`

---

### Step 7: Trigger Automated CI/CD Deployment

From your local machine or workstation:
1. Ensure `helm/backstage/values.yaml` points to your RDS endpoint and domain name.
2. Commit and push:
   ```bash
   git add .
   git commit -m "feat: trigger initial production deployment"
   git push origin main
   ```

**GitHub Actions automatically executes:**
1. **Secret Scanning**: Runs Gitleaks across commit history.
2. **Code Validation**: Executes TypeScript type checks and linting.
3. **Config Check**: Validates `app-config.yaml` and `app-config.production.yaml`.
4. **Build Release Bundle**: Compiles the React UI and backend into `dist/skeleton.tar.gz` and `dist/bundle.tar.gz`.
5. **Push to ECR**: Authenticates via AWS OIDC, builds the Docker image, and pushes to Amazon ECR.
6. **Deploy to EKS**: Assumes the OIDC role, updates `kubeconfig`, and runs `helm upgrade --install` with rolling zero-downtime updates!

---

### Step 8: Verification & Smoke Testing

Run from your server or configured local terminal:

```bash
# 1. Verify Pods across AZs (should show 3-4 Running pods)
kubectl get pods -n backstage -o wide

# 2. Check Ingress status
kubectl get ingress -n backstage

# 3. Check Horizontal Pod Autoscaler
kubectl get hpa -n backstage

# 4. View live application logs
kubectl logs -f deployment/backstage -n backstage -c backstage
```

Open your browser:
 **`https://backstage.tyagi.fun`**
- Click **"Enter as Guest"**.
- Your highly available, multi-AZ Spotify Backstage developer portal is live!

---

##  High Availability, Resilience & Pod Capacity

### 1. What happens if 1 worker node goes down?
- **Zero Downtime**: Backstage runs with `minAvailable: 2` in [pdb.yaml](helm/backstage/templates/pdb.yaml). Surviving pods in other Availability Zones immediately handle user traffic.
- **Auto-Healing**: Kubernetes Scheduler instantly schedules replacement pods on surviving nodes.
- **Hardware Replacement**: AWS Auto Scaling Group automatically launches a new EC2 instance to restore the 3-node multi-AZ cluster.
- **Database Persistence**: AWS RDS PostgreSQL Multi-AZ is completely independent of the Kubernetes nodes, ensuring zero data loss.

### 2. Node Pod Capacity (`t3.large`):
- **AWS VPC CNI Limit**: Each `t3.large` instance supports **35 pods maximum** (determined by ENI and IP allocation formula: `3 ENIs * (12 IPs - 1) + 2 = 35`).
- **Compute Capacity**: Based on Backstage requests (`250m` CPU, `512Mi` RAM), each node comfortably hosts **6 to 7 Backstage pods** in addition to system daemonsets.
- **Total Capacity across 3 nodes**: **~18 to 20 Backstage pods**, automatically scaled by HPA between 3 and 10 replicas.
