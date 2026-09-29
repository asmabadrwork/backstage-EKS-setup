# 🚀 Complete Beginner's Guide: Deploying Keycloak & Backstage on AWS EKS with CI/CD & OIDC SSO

This step-by-step master guide walks you through deploying **Keycloak 26.x** and **Backstage** from scratch (0 to 100%) on a single **AWS EKS cluster** with an automated **GitHub Actions CI/CD pipeline** and **Keycloak OIDC Single Sign-On (SSO)**.

---

## 📋 Table of Contents
1. [Phase 1: Prerequisites & Local Tools Setup](#phase-1-prerequisites--local-tools-setup)
2. [Phase 2: AWS Cloud Infrastructure & EKS Cluster Creation](#phase-2-aws-cloud-infrastructure--eks-cluster-creation)
3. [Phase 3: Deploying Keycloak on EKS](#phase-3-deploying-keycloak-on-eks)
4. [Phase 4: Keycloak Realm & OIDC Client Setup](#phase-4-keycloak-realm--oidc-client-setup)
5. [Phase 5: Backstage Code Configuration for Keycloak OIDC](#phase-5-backstage-code-configuration-for-keycloak-oidc)
6. [Phase 6: GitHub Actions CI/CD Pipeline Setup](#phase-6-github-actions-cicd-pipeline-setup)
7. [Phase 7: Deploying Backstage to EKS via CI/CD](#phase-7-deploying-backstage-to-eks-via-cicd)
8. [Phase 8: End-to-End Testing & Verification](#phase-8-end-to-end-testing--verification)

---

## Phase 1: Prerequisites & Local Tools Setup

Open PowerShell or Terminal on your local machine and install/verify the following CLI tools:

### 1.1 Install Required CLI Tools
- **AWS CLI v2**: [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **kubectl**: `winget install Kubernetes.kubectl`
- **eksctl**: `winget install eksctl`
- **Helm v3**: `winget install Helm.Helm`
- **Docker Desktop**: [Install Docker Desktop](https://www.docker.com/products/docker-desktop/)
- **Git**: `winget install Git.Git`
- **Node.js 22 & Yarn**: `winget install OpenJS.NodeJS.LTS` then run `corepack enable`

### 1.2 Verify Tool Versions
Run the following commands in PowerShell to verify installation:
```powershell
aws --version
kubectl version --client
eksctl version
helm version
docker --version
node -v
yarn -v
```

### 1.3 Configure AWS Credentials
Set up your AWS credentials for CLI access:
```powershell
aws configure
# Enter your AWS Access Key ID, Secret Access Key, Default region (e.g. ap-south-1), output format (json)
```

Verify your AWS identity:
```powershell
aws sts get-caller-identity
```

---

## Phase 2: AWS Cloud Infrastructure & EKS Cluster Creation

### 2.1 Create EKS Cluster
Using the cluster definition [eks-cluster.yaml](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/eks-cluster.yaml):

```powershell
# Navigate to workspace
cd c:\Users\lenovo\Downloads\backstage-EKS-setup

# Create EKS Cluster (takes ~15-20 minutes)
eksctl create cluster -f eks-cluster.yaml
```

Verify cluster connectivity:
```powershell
kubectl get nodes
```

### 2.2 Create Amazon ECR Repository for Backstage
```powershell
aws ecr create-repository --repository-name backstage --region ap-south-1
```

### 2.3 Install External Secrets Operator (ESO) on EKS
ESO syncs secrets safely from AWS Secrets Manager into Kubernetes secret objects.

```powershell
helm repo add external-secrets https://charts.external-secrets.io
helm repo update
helm install external-secrets external-secrets/external-secrets `
  -n external-secrets `
  --create-namespace
```

---

## Phase 3: Deploying Keycloak on EKS

Keycloak chart is located in `C:\Users\lenovo\OneDrive\Desktop\Keycloak\chart`.

### 3.1 Store Keycloak Credentials in AWS Secrets Manager
Create secret `production/keycloak/credentials` in region `ap-south-1`:

```powershell
aws secretsmanager create-secret `
  --name "production/keycloak/credentials" `
  --region ap-south-1 `
  --secret-string '{"db-host":"your-rds-endpoint.rds.amazonaws.com","db-password":"YourStrongDbPassword123!","admin-password":"YourSuperAdminPassword123!"}'
```

### 3.2 Create TLS Secret in Kubernetes (Namespace: `keycloak`)
```powershell
kubectl create namespace keycloak

# Create TLS secret (Replace fullchain.pem and private.key with your SSL cert paths)
kubectl create secret tls keycloak-tls-secret `
  --cert=fullchain.pem `
  --key=private.key `
  -n keycloak
```

### 3.3 Deploy Keycloak via Helm
```powershell
helm upgrade --install keycloak "C:\Users\lenovo\OneDrive\Desktop\Keycloak\chart" `
  --namespace keycloak `
  --create-namespace
```

### 3.4 Verify Keycloak Deployment
```powershell
kubectl get pods -n keycloak
kubectl get ingress -n keycloak
```

Wait until pods show `2/2 Running`.

---

## Phase 4: Keycloak Realm & OIDC Client Setup

1. Open your browser and navigate to your Keycloak Admin Console:
   - **URL**: `https://keycloak.tyagi.fun/admin`
   - **Username**: `admin`
   - **Password**: `YourSuperAdminPassword123!`

2. **Create Realm**:
   - Top-left dropdown ➔ Click **Create Realm**
   - Realm name: `backstage` ➔ Click **Create**

3. **Create OIDC Client**:
   - Go to **Clients** ➔ Click **Create client**
   - **Client type**: `OpenID Connect`
   - **Client ID**: `backstage` ➔ Click **Next**
   - **Capability config**:
     - Client authentication: **ON** *(Confidential)*
     - Authorization: **OFF**
     - Authentication flow: **Standard flow** checked
   - Click **Save**

4. **Configure Client URLs**:
   - **Root URL**: `https://<your-backstage-domain>`
   - **Valid redirect URIs**:
     - `https://<your-backstage-domain>/api/auth/oidc/handler/frame`
     - `http://localhost:7007/api/auth/oidc/handler/frame`
   - **Web Origins**:
     - `https://<your-backstage-domain>`
     - `http://localhost:3000`
   - Click **Save**

5. **Copy Client Secret**:
   - Go to **Credentials** tab ➔ Copy **Client Secret**.

6. **Create Test User**:
   - Go to **Users** ➔ Click **Add user**
   - Username: `devuser`
   - Email: `devuser@example.com`
   - Go to **Credentials** tab ➔ Click **Set password** (turn off *Temporary*).

---

## Phase 5: Backstage Code Configuration for Keycloak OIDC

### 5.1 Add OIDC Backend Module
In your terminal inside `c:\Users\lenovo\Downloads\backstage-EKS-setup`:

```powershell
yarn --cwd packages/backend add @backstage/plugin-auth-backend-module-oidc-provider
```

### 5.2 Register OIDC Provider in `packages/backend/src/index.ts`
Add the OIDC provider import:

```typescript
// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-oidc-provider'));
```

### 5.3 Configure `app-config.production.yaml`
Add OIDC auth configuration under `auth.providers`:

```yaml
auth:
  environment: production
  providers:
    oidc:
      production:
        metadataUrl: https://keycloak-aws.opstree.dev/realms/master/.well-known/openid-configuration
        clientId: ${AUTH_OIDC_CLIENT_ID}
        clientSecret: ${AUTH_OIDC_CLIENT_SECRET}
        prompt: auto
        signIn:
          resolvers:
            - resolver: preferredUsernameMatchingUserEntityAnnotation
            - resolver: emailMatchingUserEntityProfileEmail
            - resolver: emailLocalPartMatchingUserEntityName
```

### 5.4 Configure Frontend Sign-In Component (`packages/app/src/App.tsx`)
```tsx
import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';
import { homeModule } from './modules/home';
import { oidcAuthApiRef } from '@backstage/core-plugin-api';
import { SignInPage } from '@backstage/core-components';

export default createApp({
  features: [catalogPlugin, navModule, homeModule],
  components: {
    SignInPage: props => (
      <SignInPage
        {...props}
        auto
        provider={{
          id: 'oidc',
          title: 'Keycloak SSO',
          message: 'Sign in using Keycloak',
          apiRef: oidcAuthApiRef,
        }}
      />
    ),
  },
});
```

---

## Phase 6: GitHub Actions CI/CD Pipeline Setup

### 6.1 Set Up AWS OIDC Role for GitHub Actions
Create an IAM Role `GitHubActionsEKSRole` trusting GitHub OIDC provider (`token.actions.githubusercontent.com`) with permissions to:
- Push to Amazon ECR (`AmazonEC2ContainerRegistryPowerUser`)
- Access EKS Cluster (`eks:DescribeCluster`)

### 6.2 Configure GitHub Repository Variables & Secrets
Go to your GitHub Repository ➔ **Settings** ➔ **Secrets and variables** ➔ **Actions**:

**Variables**:
- `AWS_REGION`: `ap-south-1`
- `EKS_CLUSTER_NAME`: `backstage-production`
- `ECR_REPOSITORY`: `backstage`
- `K8S_NAMESPACE`: `backstage`

**Secrets / Variables**:
- `AWS_ROLE_ARN`: `arn:aws:iam::<your-account-id>:role/GitHubActionsEKSRole`

---

## Phase 7: Deploying Backstage to EKS via CI/CD

### 7.1 Push Code to GitHub
```powershell
git add .
git commit -m "feat: Configure Keycloak OIDC SSO and CI/CD deployment pipeline"
git push origin main
```

### 7.2 Watch GitHub Actions CI/CD Pipeline
1. Go to your GitHub repository ➔ **Actions** tab.
2. Observe the **Backstage CI/CD Pipeline**:
   - ✅ Stage 1: Security scanning, linting, typechecking, and tests pass.
   - ✅ Stage 2: Builds release bundle & pushes Docker image to Amazon ECR.
   - ✅ Stage 3: Connects to AWS EKS and runs `helm upgrade backstage ./helm/backstage`.

---

## Phase 8: End-to-End Testing & Verification

1. Check Backstage pod status on EKS:
   ```powershell
   kubectl get pods -n backstage
   kubectl get ingress -n backstage
   ```

2. Access Backstage in your browser (`https://<your-backstage-domain>`).
3. You will be greeted with **Sign in using Keycloak**.
4. Click **Sign In with Keycloak** ➔ Enter `devuser` and password.
5. Successfully authenticated! You are now redirected back into your custom Backstage developer portal! 🎉
