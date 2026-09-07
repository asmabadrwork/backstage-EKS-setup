# Spotify Backstage - Production Deployment on AWS EKS

This repository contains the enterprise-grade production setup for the **Spotify Backstage Developer Portal** deployed on **AWS Elastic Kubernetes Service (EKS)** with **Amazon RDS PostgreSQL (Multi-AZ)**, **AWS Secrets Manager**, **External Secrets Operator (ESO)**, **Amazon ECR**, and **Nginx Ingress with ZeroSSL TLS encryption**.

---

## 🏛️ Production Architecture & Technology Stack

```
[ Users & Developers ]
         │ (HTTPS / 443)
         ▼
[ DNS (Hostinger / Route 53) ]
         │
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
│   ├── Pod 1 (AZ-a)             [ Pod Disruption Budget (PDB) ]         │
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
- **Runtime**: Node.js 22 LTS & Yarn Berry v4 Monorepo
- **Kubernetes**: AWS EKS v1.32 across 3 Availability Zones (`ap-south-1a`, `ap-south-1b`, `ap-south-1c`)
- **Networking**: VPC `10.30.0.0/16` with Highly Available NAT Gateways (1 per AZ)
- **Database**: Amazon RDS for PostgreSQL (Multi-AZ, SSL encrypted)
- **Secrets Management**: AWS Secrets Manager synced via External Secrets Operator (ESO `v1`) with IAM Roles for Service Accounts (IRSA)
- **Ingress & SSL**: Nginx Ingress Controller with ZeroSSL Full Chain TLS certificates
- **Resilience**: Horizontal Pod Autoscaler (`hpa.yaml`), Pod Disruption Budget (`pdb.yaml`), and `topologySpreadConstraints` across zones

---

## 📁 Repository Structure

```text
.
├── .github/workflows/
│   ├── ci.yml                 # CI: Secret scanning (Gitleaks), Type checking, Linting, Build
│   └── cd.yml                 # CD: Automated Docker build, ECR push, and Helm upgrade
├── helm/
│   └── backstage/             # Production Helm Chart
│       ├── Chart.yaml         # Chart metadata
│       ├── values.yaml        # Configurable deployment values (domain, RDS host, secrets)
│       └── templates/
│           ├── _helpers.tpl   # Template helper macros
│           ├── backstage.yaml # Deployment (HPA/HA) & ClusterIP Service
│           ├── external-secrets.yaml # ESO SecretStore & ExternalSecret (v1)
│           ├── hpa.yaml       # Horizontal Pod Autoscaler
│           ├── ingress.yaml   # Nginx Ingress with TLS
│           ├── pdb.yaml       # Pod Disruption Budget
│           ├── postgres-secrets.yaml # Fallback DB Secret generator
│           └── secrets.yaml   # Fallback App Secret generator
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

## 🚀 End-to-End Setup Guide (From Scratch)

### Step 1: Install Prerequisites on EC2 / Bastion Machine
Log into an **Ubuntu 22.04 / 24.04** server and run:

```bash
# 1. Base tools
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl wget git jq unzip tar apt-transport-https ca-certificates gnupg

# 2. AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip -q awscliv2.zip && sudo ./aws/install --update && rm -rf aws awscliv2.zip

# 3. Docker Engine
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
sudo usermod -aG docker $USER && sudo systemctl enable --now docker

# 4. Node.js 22 LTS & Yarn Berry v4
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo corepack enable && corepack prepare yarn@4.13.0 --activate

# 5. kubectl (v1.32)
curl -LO "https://dl.k8s.io/release/v1.32.0/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl

# 6. eksctl
curl -sLO "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz"
tar -xzf "eksctl_Linux_amd64.tar.gz" -C /tmp && sudo mv /tmp/eksctl /usr/local/bin && rm "eksctl_Linux_amd64.tar.gz"

# 7. Helm v3
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
chmod 700 get_helm.sh && ./get_helm.sh && rm get_helm.sh

newgrp docker
```

---

### Step 2: Configure AWS CLI & Environment Variables

```bash
aws configure
# Enter AWS Access Key, Secret Key, and Region: ap-south-1

# Export environment variables
export AWS_REGION="ap-south-1"
export CLUSTER_NAME="backstage-production"
export DOMAIN="backstage.yourdomain.com"
export DB_PASSWORD="YourStrongSecurePassword123!"
export GITHUB_TOKEN="ghp_yourActualGitHubToken"
export AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
```

---

### Step 3: Provision Multi-AZ EKS Cluster

From the repository root:
```bash
eksctl create cluster -f eks-cluster.yaml
```
*(Provisions 3 worker nodes across 3 AZs with EBS CSI driver and HA NAT Gateways in ~15 minutes)*.

Verify:
```bash
kubectl get nodes -o wide
```

---

### Step 4: Provision Amazon RDS for PostgreSQL (Multi-AZ)

```bash
# 1. Get EKS VPC ID
VPC_ID=$(aws eks describe-cluster --name $CLUSTER_NAME --region $AWS_REGION --query "cluster.resourcesVpcConfig.vpcId" --output text)

# 2. Create Security Group for RDS
RDS_SG_ID=$(aws ec2 create-security-group \
  --group-name backstage-rds-sg \
  --description "Security group for Backstage RDS" \
  --vpc-id $VPC_ID \
  --region $AWS_REGION \
  --query "GroupId" --output text)

# Allow port 5432 from EKS VPC CIDR
aws ec2 authorize-security-group-ingress \
  --group-id $RDS_SG_ID \
  --protocol tcp \
  --port 5432 \
  --cidr 10.30.0.0/16 \
  --region $AWS_REGION

# 3. Create DB Subnet Group across private subnets
PRIVATE_SUBNETS=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:kubernetes.io/role/internal-elb,Values=1" \
  --region $AWS_REGION \
  --query "Subnets[*].SubnetId" --output text)

aws rds create-db-subnet-group \
  --db-subnet-group-name backstage-db-subnets \
  --db-subnet-group-description "Private subnets for Backstage RDS" \
  --subnet-ids $PRIVATE_SUBNETS \
  --region $AWS_REGION

# 4. Fetch latest PostgreSQL 15 minor version
PG_VERSION=$(aws rds describe-db-engine-versions \
  --engine postgres \
  --region $AWS_REGION \
  --query "reverse(sort(DBEngineVersions[?starts_with(EngineVersion, '15.')].EngineVersion))[0]" \
  --output text)

# 5. Launch Multi-AZ RDS Instance
aws rds create-db-instance \
  --db-instance-identifier backstage-production-db \
  --db-instance-class db.t4g.medium \
  --engine postgres \
  --engine-version $PG_VERSION \
  --master-username backstage \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 20 \
  --max-allocated-storage 100 \
  --db-name postgres \
  --vpc-security-group-ids $RDS_SG_ID \
  --db-subnet-group-name backstage-db-subnets \
  --multi-az \
  --storage-encrypted \
  --no-publicly-accessible \
  --region $AWS_REGION
```

Capture the RDS endpoint once available:
```bash
export RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier backstage-production-db \
  --region $AWS_REGION \
  --query "DBInstances[0].Endpoint.Address" --output text)
echo "RDS Endpoint: $RDS_ENDPOINT"
```

---

### Step 5: Install Ingress Controller & Configure DNS

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.type=LoadBalancer

# Get AWS Load Balancer Hostname
export INGRESS_HOST=$(kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')
echo "Point your DNS CNAME to: $INGRESS_HOST"
```

> **DNS Action**: In your DNS provider (Hostinger, Cloudflare, Route53), create a **CNAME** record:
> - **Host/Name**: `backstage`
> - **Target/Content**: `$INGRESS_HOST`

---

### Step 6: Configure ZeroSSL Certificates

```bash
kubectl create namespace backstage

# Create full certificate chain (Domain Certificate + ZeroSSL CA Bundle)
cat certificate.crt ca_bundle.crt > fullchain.crt

# Create Kubernetes TLS Secret
kubectl create secret tls backstage-tls \
  --cert=fullchain.crt \
  --key=private.key \
  --namespace backstage
```

---

### Step 7: Build & Push Backstage to Amazon ECR

```bash
# 1. Create ECR Repository
aws ecr create-repository --repository-name backstage --region $AWS_REGION --image-scanning-configuration scanOnPush=true || true

# 2. Authenticate Docker with ECR
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# 3. Build Monorepo Release Artifacts & Docker Container
yarn install --immutable
yarn tsc
yarn build:backend
docker build -t $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/backstage:1.0.0 .
docker push $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/backstage:1.0.0

# 4. Create Kubernetes ImagePullSecret
kubectl create secret docker-registry ecr-secret \
  --docker-server=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com \
  --docker-username=AWS \
  --docker-password=$(aws ecr get-login-password --region $AWS_REGION) \
  --namespace backstage
```

---

### Step 8: Configure AWS Secrets Manager & External Secrets Operator (ESO)

```bash
# 1. Create/Update Secret in AWS Secrets Manager
export BACKEND_SECRET=$(openssl rand -base64 32)

aws secretsmanager create-secret \
  --name "production/backstage" \
  --region $AWS_REGION \
  --secret-string "{
    \"POSTGRES_USER\": \"backstage\",
    \"POSTGRES_PASSWORD\": \"$DB_PASSWORD\",
    \"GITHUB_TOKEN\": \"$GITHUB_TOKEN\",
    \"BACKEND_SECRET\": \"$BACKEND_SECRET\"
  }" 2>/dev/null || \
aws secretsmanager put-secret-value \
  --secret-id "production/backstage" \
  --region $AWS_REGION \
  --secret-string "{
    \"POSTGRES_USER\": \"backstage\",
    \"POSTGRES_PASSWORD\": \"$DB_PASSWORD\",
    \"GITHUB_TOKEN\": \"$GITHUB_TOKEN\",
    \"BACKEND_SECRET\": \"$BACKEND_SECRET\"
  }"

# 2. Install External Secrets Operator (v1 CRDs)
helm repo add external-secrets https://charts.external-secrets.io
helm repo update
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace \
  --set installCRDs=true

# 3. Enable IRSA (IAM Roles for Service Accounts)
eksctl utils associate-iam-oidc-provider --cluster $CLUSTER_NAME --region $AWS_REGION --approve

eksctl create iamserviceaccount \
  --name external-secrets-sa \
  --namespace backstage \
  --cluster $CLUSTER_NAME \
  --region $AWS_REGION \
  --attach-policy-arn arn:aws:iam::aws:policy/SecretsManagerReadWrite \
  --approve
```

---

### Step 9: Deploy Backstage with Helm

Deploy Backstage using external PostgreSQL and External Secrets Operator:

```bash
helm upgrade --install backstage ./helm/backstage \
  --namespace backstage \
  --set domain="$DOMAIN" \
  --set backstage.image.repository="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/backstage" \
  --set backstage.image.tag="1.0.0" \
  --set postgres.host="$RDS_ENDPOINT" \
  --set postgres.port=5432 \
  --set postgres.user="backstage" \
  --set postgres.database="postgres" \
  --set postgres.ssl=true \
  --set externalSecrets.enabled=true \
  --set secrets.create=false \
  --set postgres.createSecret=false
```

---

### Step 10: Verification & Smoke Testing

```bash
# 1. Check Pod status across 3 AZs
kubectl get pods -n backstage -o wide

# 2. Check ExternalSecret sync status
kubectl get externalsecret -n backstage

# 3. View live application logs (DB migrations & HTTP routes)
kubectl logs -f deployment/backstage -n backstage -c backstage

# 4. Check Ingress status
kubectl get ingress -n backstage
```

Open **`https://<YOUR_DOMAIN>`** in your browser. The ZeroSSL secure padlock will appear, allowing you to log in via **Guest mode** and browse your Software Catalog!

---

## 🔄 Automated CI/CD Pipeline (GitHub Actions + AWS OIDC)

Continuous deployment is handled natively via GitHub Actions in [.github/workflows/cd.yml](.github/workflows/cd.yml) with **zero long-lived AWS keys and zero SSH bastions**.

### 1. Configure GitHub Actions OIDC in AWS
Run these commands on your EC2 or workstation to authorize GitHub Actions:

```bash
# 1. Create GitHub OIDC Identity Provider in AWS IAM (if not already existing)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 1c58a3a8518e8759bf075b76b750d4f8d264fcd9 2>/dev/null || true

# 2. Create IAM Role Trust Policy for your repository
cat <<EOF > /tmp/github-oidc-trust.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::$AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:asmabadrwork/backstage-EKS-setup:*"
        }
      }
    }
  ]
}
EOF

# 3. Create the Deployer IAM Role
aws iam create-role \
  --role-name github-actions-backstage-cd \
  --assume-role-policy-document file:///tmp/github-oidc-trust.json

# 4. Attach ECR Push Permissions
aws iam attach-role-policy \
  --role-name github-actions-backstage-cd \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

# 5. Attach EKS Cluster Describe Permission
cat <<EOF > /tmp/eks-describe-policy.json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["eks:DescribeCluster"],
      "Resource": "arn:aws:eks:$AWS_REGION:$AWS_ACCOUNT_ID:cluster/$CLUSTER_NAME"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name github-actions-backstage-cd \
  --policy-name EKSDescribeCluster \
  --policy-document file:///tmp/eks-describe-policy.json

# 6. Grant Deployer Role Access to EKS Cluster
aws eks create-access-entry \
  --cluster-name $CLUSTER_NAME \
  --principal-arn arn:aws:iam::$AWS_ACCOUNT_ID:role/github-actions-backstage-cd \
  --type STANDARD \
  --region $AWS_REGION

aws eks associate-access-policy \
  --cluster-name $CLUSTER_NAME \
  --principal-arn arn:aws:iam::$AWS_ACCOUNT_ID:role/github-actions-backstage-cd \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster \
  --region $AWS_REGION
```

### 2. Configure GitHub Repository Secret
Go to **GitHub Repository** ➔ **Settings** ➔ **Secrets and variables** ➔ **Actions**:
- Add Secret: `AWS_ROLE_ARN` = `arn:aws:iam::<AWS_ACCOUNT_ID>:role/github-actions-backstage-cd`

Every time code is pushed to `main`, GitHub Actions will:
1. Scan for leaked secrets using Gitleaks.
2. Run TypeScript checks, linting, and Backstage config checks.
3. Build the backend bundle.
4. Assume the AWS IAM role via OIDC and push the container to Amazon ECR.
5. Connect directly to Amazon EKS and execute `helm upgrade` with rolling zero-downtime deployment!

---

## 🛠️ Helm Values Reference

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `domain` | `example.com` | Primary application domain used by Ingress & BaseURL. |
| `backstage.replicaCount` | `3` | Number of HA pod replicas. |
| `backstage.image.repository` | `<ECR_REPO_URL>` | Amazon ECR container repository. |
| `backstage.image.tag` | `1.0.0` | Container image tag. |
| `backstage.service.port` | `80` | ClusterIP service port. |
| `backstage.service.targetPort`| `7007` | Backend container listening port. |
| `postgres.host` | `""` | Amazon RDS PostgreSQL endpoint address. |
| `postgres.ssl` | `true` | Enables encrypted TLS connection to AWS RDS. |
| `postgres.createSecret` | `true` | Set to `false` when using External Secrets Operator. |
| `externalSecrets.enabled` | `false` | Enables AWS Secrets Manager sync via ESO (v1). |
| `externalSecrets.awsSecretName` | `"production/backstage"` | Secret name in AWS Secrets Manager. |
| `tls.enabled` | `true` | Enables TLS termination in Ingress. |
| `tls.secretName` | `backstage-tls` | Secret containing TLS certificate and private key. |
