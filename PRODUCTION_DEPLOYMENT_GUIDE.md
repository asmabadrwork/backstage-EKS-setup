# Production Deployment Master Guide: Backstage on AWS EKS with Keycloak OIDC, AWS Secrets Manager & GitHub Actions CI/CD

This document provides a single, comprehensive, production-grade master guide for deploying **Backstage** on **AWS EKS** using **Keycloak 26.x OIDC Single Sign-On (SSO)**, **External Secrets Operator (ESO)**, **Amazon RDS PostgreSQL**, and **GitHub Actions CI/CD** with AWS OIDC authentication.

All infrastructure resources (EKS Cluster, Node Groups, IAM Roles, AWS Secrets Manager, Bastion EC2, and ECR Repositories) are assumed to be provisioned via Terraform / Infrastructure as Code (IaC).

---

## Table of Contents
1. [Infrastructure Parameters & Variable Mapping](#1-infrastructure-parameters--variable-mapping)
2. [AWS IAM OIDC Provider & Service Account Roles (IRSA)](#2-aws-iam-oidc-provider--service-account-roles-irsa)
   - [2.1 GitHub Actions Deployment IAM Role (`<GITHUB_ROLE_NAME>`)](#21-github-actions-deployment-iam-role-github_role_name)
   - [2.2 External Secrets Operator IRSA Role (`<ESO_ROLE_NAME>`)](#22-external-secrets-operator-irsa-role-eso_role_name)
3. [AWS Secrets Manager Setup (`<AWS_SECRET_NAME>`)](#3-aws-secrets-manager-setup-aws_secret_name)
4. [GitHub Repository Secrets & Variables Matrix](#4-github-repository-secrets--variables-matrix)
5. [Keycloak OIDC Realm & Client Setup](#5-keycloak-oidc-realm--client-setup)
6. [Backstage Code Configuration for Keycloak OIDC](#6-backstage-code-configuration-for-keycloak-oidc)
7. [Backstage Helm Chart & Node Scheduling Setup](#7-backstage-helm-chart--node-scheduling-setup)
8. [GitHub Actions CI/CD Pipeline Workflow](#8-github-actions-cicd-pipeline-workflow)
9. [Step-by-Step Execution & Deployment Procedure](#9-step-by-step-execution--deployment-procedure)
10. [Troubleshooting & Maintenance Checklist](#10-troubleshooting--maintenance-checklist)

---

## 1. Infrastructure Parameters & Variable Mapping

When deploying to client environments, replace the placeholder variables below with values exported by your Terraform modules:

| Variable Placeholder | Description | Example / Reference Value |
| :--- | :--- | :--- |
| `<AWS_ACCOUNT_ID>` | 12-digit AWS Account ID | `724446904294` |
| `<AWS_REGION>` | Target AWS Region | `ap-south-1` |
| `<EKS_CLUSTER_NAME>` | Name of the Amazon EKS Cluster | `dev-negd-eks` |
| `<EKS_OIDC_ID>` | OIDC Issuer Hash ID for EKS Cluster | `EXXXXXXXXXXXXXXX` |
| `<K8S_NAMESPACE>` | Target Kubernetes Namespace | `backstage` |
| `<TARGET_NODEGROUP>` | Target EC2 Nodegroup Name | `dev-negd-ng-db` |
| `<TARGET_NODE_TAINT_KEY>` | Nodegroup Taint Key | `dedicated` |
| `<TARGET_NODE_TAINT_VALUE>` | Nodegroup Taint Value | `database` |
| `<TARGET_NODE_TAINT_EFFECT>` | Nodegroup Taint Effect | `NoSchedule` |
| `<BASTION_INSTANCE_ID>` | EC2 Bastion Instance ID for SSM Tunnel | `i-0effba6ccca9f949f` |
| `<ECR_REPOSITORY>` | Amazon ECR Repository Name | `backstage` |
| `<AWS_SECRET_NAME>` | AWS Secrets Manager Secret Name | `production/backstage` |
| `<GITHUB_ORG>` | GitHub Organization / Owner Name | `asmabadrwork` |
| `<GITHUB_REPO>` | GitHub Repository Name | `backstage-EKS-setup` |
| `<BACKSTAGE_DOMAIN>` | Fully Qualified Domain Name for Backstage | `backstage-aws.opstree.dev` |
| `<KEYCLOAK_DOMAIN>` | Fully Qualified Domain Name for Keycloak | `keycloak-aws.opstree.dev` |
| `<POSTGRES_HOST>` | Amazon RDS PostgreSQL Endpoint | `your-rds-endpoint.cXXXXXX.ap-south-1.rds.amazonaws.com` |
| `<POSTGRES_USER>` | PostgreSQL Master Admin Username | `keycloakadmin` |
| `<GITHUB_ROLE_ARN>` | IAM Role ARN for GitHub Actions OIDC | `arn:aws:iam::<AWS_ACCOUNT_ID>:role/github-actions-eks-deploy` |
| `<ESO_ROLE_ARN>` | IAM Role ARN for External Secrets IRSA | `arn:aws:iam::<AWS_ACCOUNT_ID>:role/backstage-external-secrets` |

---

## 2. AWS IAM OIDC Provider & Service Account Roles (IRSA)

### 2.1 GitHub Actions Deployment IAM Role (`<GITHUB_ROLE_NAME>`)

This IAM role enables GitHub Actions to authenticate via OpenID Connect (OIDC), push container images to Amazon ECR, inspect EKS cluster configuration, and create an AWS SSM Session Manager port-forwarding tunnel.

#### Step 1: Ensure IAM OIDC Provider Exists for GitHub
- **Provider URL**: `https://token.actions.githubusercontent.com`
- **Audience**: `sts.amazonaws.com`

#### Step 2: Role Trust Policy (`<GITHUB_ROLE_NAME>`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<GITHUB_REPO>:*"
        }
      }
    }
  ]
}
```

#### Step 3: Inline Permission Policy (`GitHubActionsEKSPermissions`)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRAuthAndPush",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:GetRepositoryPolicy",
        "ecr:DescribeRepositories",
        "ecr:ListImages",
        "ecr:DescribeImages",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "*"
    },
    {
      "Sid": "EKSClusterDescribe",
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster"
      ],
      "Resource": "arn:aws:eks:<AWS_REGION>:<AWS_ACCOUNT_ID>:cluster/<EKS_CLUSTER_NAME>"
    },
    {
      "Sid": "SSMTunnelForBastion",
      "Effect": "Allow",
      "Action": [
        "ssm:StartSession",
        "ssm:SendCommand",
        "ssm:TerminateSession",
        "ssm:ResumeSession",
        "ssm:DescribeSessions"
      ],
      "Resource": [
        "arn:aws:ec2:<AWS_REGION>:<AWS_ACCOUNT_ID>:instance/<BASTION_INSTANCE_ID>",
        "arn:aws:ssm:<AWS_REGION>::document/AWS-StartPortForwardingSessionToRemoteHost"
      ]
    }
  ]
}
```

---

### 2.2 External Secrets Operator IRSA Role (`<ESO_ROLE_NAME>`)

This IAM role grants the Kubernetes ServiceAccount (`external-secrets-sa`) in namespace `<K8S_NAMESPACE>` permission to read secrets from AWS Secrets Manager.

#### Trust Policy (Bound to EKS OIDC Provider & ServiceAccount)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/oidc.eks.<AWS_REGION>.amazonaws.com/id/<EKS_OIDC_ID>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.eks.<AWS_REGION>.amazonaws.com/id/<EKS_OIDC_ID>:sub": "system:serviceaccount:<K8S_NAMESPACE>:external-secrets-sa",
          "oidc.eks.<AWS_REGION>.amazonaws.com/id/<EKS_OIDC_ID>:aud": "sts.amazonaws.com"
        }
      }
    }
  ]
}
```

#### Permission Policy (`BackstageSecretsManagerAccess`)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:<AWS_REGION>:<AWS_ACCOUNT_ID>:secret:<AWS_SECRET_NAME>-*"
    }
  ]
}
```

#### CLI / eksctl Creation Command Option
```bash
# 1. Create IAM Policy for Secrets Manager Access
aws iam create-policy \
  --policy-name BackstageSecretsManagerAccess \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
      "Resource": "arn:aws:secretsmanager:<AWS_REGION>:<AWS_ACCOUNT_ID>:secret:<AWS_SECRET_NAME>-*"
    }]
  }'

# 2. Create IAM Role and bind to EKS ServiceAccount (external-secrets-sa)
eksctl create iamserviceaccount \
  --name external-secrets-sa \
  --namespace <K8S_NAMESPACE> \
  --cluster <EKS_CLUSTER_NAME> \
  --region <AWS_REGION> \
  --role-name <ESO_ROLE_NAME> \
  --attach-policy-arn arn:aws:iam::<AWS_ACCOUNT_ID>:policy/BackstageSecretsManagerAccess \
  --approve \
  --override-existing-serviceaccounts
```

---

## 3. AWS Secrets Manager Setup (`<AWS_SECRET_NAME>`)

Create the secret key in AWS Secrets Manager using AWS CLI, Terraform, or AWS Console:

```bash
aws secretsmanager create-secret \
  --name "<AWS_SECRET_NAME>" \
  --region <AWS_REGION> \
  --secret-string '{
    "POSTGRES_USER": "<POSTGRES_USER>",
    "POSTGRES_PASSWORD": "<YOUR_STRONG_RDS_PASSWORD>",
    "GITHUB_TOKEN": "<YOUR_GITHUB_PAT>",
    "BACKEND_SECRET": "<YOUR_RANDOM_64_BYTE_AUTH_SECRET>",
    "AUTH_OIDC_CLIENT_ID": "backstage",
    "AUTH_OIDC_CLIENT_SECRET": "<YOUR_RAW_KEYCLOAK_CLIENT_SECRET>"
  }'
```

> **CRITICAL NOTE ON CLIENT SECRET**: Store `AUTH_OIDC_CLIENT_SECRET` as the raw un-encoded secret string copied directly from the Keycloak Admin Console.

---

## 4. GitHub Repository Secrets & Variables Matrix

Configure these parameters in GitHub: **Repository Settings** -> **Secrets and variables** -> **Actions**.

### Variables (Environment Variables)

| Variable Name | Value | Description |
| :--- | :--- | :--- |
| `AWS_REGION` | `<AWS_REGION>` | Target AWS Region |
| `EKS_CLUSTER_NAME` | `<EKS_CLUSTER_NAME>` | Target EKS Cluster Name |
| `ECR_REPOSITORY` | `<ECR_REPOSITORY>` | Amazon ECR Repository Name |
| `K8S_NAMESPACE` | `<K8S_NAMESPACE>` | Target Kubernetes Namespace |
| `BASTION_INSTANCE_ID` | `<BASTION_INSTANCE_ID>` | EC2 Bastion Instance ID for SSM Tunnel |
| `DOMAIN` | `<BACKSTAGE_DOMAIN>` | Public HTTPS Domain for Backstage |
| `POSTGRES_HOST` | `<POSTGRES_HOST>` | Amazon RDS PostgreSQL Endpoint |
| `POSTGRES_USER` | `<POSTGRES_USER>` | PostgreSQL Master Username |
| `AWS_SECRET_NAME` | `<AWS_SECRET_NAME>` | AWS Secrets Manager Secret Name |

### Secrets (Encrypted Secrets)

| Secret Name | Value | Description |
| :--- | :--- | :--- |
| `AWS_ROLE_ARN` | `<GITHUB_ROLE_ARN>` | IAM Role ARN for GitHub Actions OIDC |

---

## 5. Keycloak OIDC Realm & Client Setup

1. Open Keycloak Admin Console in your browser: `https://<KEYCLOAK_DOMAIN>/admin`
2. Select target Realm (e.g. `master` or create a new realm `backstage`).
3. Create OIDC Client:
   - Go to **Clients** -> **Create client**
   - **Client type**: `OpenID Connect`
   - **Client ID**: `backstage` -> Click **Next**
   - **Capability config**:
     - Client authentication: **ON** *(Confidential)*
     - Authorization: **OFF**
     - Authentication flow: **Standard flow** checked
   - Click **Save**
4. Configure Client Access Settings & URIs:
   - **Root URL**: `https://<BACKSTAGE_DOMAIN>`
   - **Home URL**: `https://<BACKSTAGE_DOMAIN>`
   - **Valid Redirect URIs**:
     - `https://<BACKSTAGE_DOMAIN>/api/auth/oidc/handler/frame`
     - `http://localhost:7007/api/auth/oidc/handler/frame`
   - **Web Origins**:
     - `https://<BACKSTAGE_DOMAIN>`
     - `http://localhost:3000`
   - Click **Save**
5. Copy Client Secret from **Credentials** tab and store it in AWS Secrets Manager (`<AWS_SECRET_NAME>` -> `AUTH_OIDC_CLIENT_SECRET`).

---

## 6. Backstage Code Configuration for Keycloak OIDC

### 6.1 Install OIDC Backend Plugin Module
```bash
yarn --cwd packages/backend add @backstage/plugin-auth-backend-module-oidc-provider
```

### 6.2 Register OIDC Provider in `packages/backend/src/index.ts`
```typescript
// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-oidc-provider'));
```

### 6.3 Configure `app-config.production.yaml`
```yaml
auth:
  environment: production
  session:
    secret: ${BACKEND_SECRET}
  providers:
    guest: {}
    oidc:
      production:
        metadataUrl: ${AUTH_OIDC_METADATA_URL:https://<KEYCLOAK_DOMAIN>/realms/master/.well-known/openid-configuration}
        clientId: 'backstage'
        clientSecret: ${AUTH_OIDC_CLIENT_SECRET}
        prompt: auto
        signIn:
          resolvers:
            - resolver: emailLocalPartMatchingUserEntityName
              dangerouslyAllowSignInWithoutUserInCatalog: true
            - resolver: emailMatchingUserEntityProfileEmail
              dangerouslyAllowSignInWithoutUserInCatalog: true
```

### 6.4 Configure Frontend Sign-In Component (`packages/app/src/App.tsx`)
```tsx
import { oidcAuthApiRef } from '@backstage/core-plugin-api';
import { SignInPage } from '@backstage/core-components';

export default createApp({
  features: [...],
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

## 7. Backstage Helm Chart & Node Scheduling Setup

### 7.1 Worker Node Placement (`nodeSelector` & `tolerations`)
In [`helm/backstage/values.yaml`](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/helm/backstage/values.yaml), configure target node pool placement:

```yaml
backstage:
  replicaCount: 1

nodeSelector:
  eks.amazonaws.com/nodegroup: <TARGET_NODEGROUP>

tolerations:
  - key: "<TARGET_NODE_TAINT_KEY>"
    operator: "Equal"
    value: "<TARGET_NODE_TAINT_VALUE>"
    effect: "<TARGET_NODE_TAINT_EFFECT>"
```

### 7.2 ServiceAccount IRSA Configuration
In [`helm/backstage/values.yaml`](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/helm/backstage/values.yaml):

```yaml
serviceAccount:
  create: true
  name: external-secrets-sa
  annotations:
    eks.amazonaws.com/role-arn: "<ESO_ROLE_ARN>"
```

### 7.3 Database Connection Pool Optimization (`app-config.production.yaml`)
To avoid PostgreSQL connection limit exhaustion across Backstage plugins:

```yaml
backend:
  database:
    client: pg
    ensureExists: true
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT:5432}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
      database: ${POSTGRES_DATABASE:postgres}
      ssl:
        rejectUnauthorized: false
    knexConfig:
      searchPath: ['public']
      pool:
        min: 0
        max: 2
        acquireTimeoutMillis: 60000
        createTimeoutMillis: 60000
        idleTimeoutMillis: 10000
```

---

## 8. GitHub Actions CI/CD Pipeline Workflow

The pipeline defined in [`.github/workflows/ci-cd.yml`](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/.github/workflows/ci-cd.yml) executes the following stages:

- **Stage 1 (CI Security & Verification)**: Gitleaks secret scanning (with `fetch-depth: 0`), code linting, typechecking (`tsc:full`), unit tests, and configuration validation.
- **Stage 2 (Build Release Bundle)**: Compiles frontend and backend bundles via `yarn build:all`.
- **Stage 3 (Docker Build & ECR Push)**: Authenticates to ECR via AWS OIDC Role `<GITHUB_ROLE_ARN>` and pushes tagged container images.
- **Stage 4 (EKS Deployment)**: Connects via SSM Session Manager port-forwarding to bastion `<BASTION_INSTANCE_ID>` and executes `helm upgrade --install backstage ./helm/backstage`.

---

## 9. Step-by-Step Execution & Deployment Procedure

### Step 1: Populate AWS Secrets Manager
```bash
aws secretsmanager create-secret \
  --name "<AWS_SECRET_NAME>" \
  --region <AWS_REGION> \
  --secret-string '{"POSTGRES_USER":"<POSTGRES_USER>","POSTGRES_PASSWORD":"<POSTGRES_PASSWORD>","GITHUB_TOKEN":"<GITHUB_TOKEN>","BACKEND_SECRET":"<BACKEND_SECRET>","AUTH_OIDC_CLIENT_ID":"backstage","AUTH_OIDC_CLIENT_SECRET":"<AUTH_OIDC_CLIENT_SECRET>"}'
```

### Step 2: Push Code to Trigger GitHub Actions Workflow
```bash
git add .
git commit -m "feat: deploy backstage to production eks cluster"
git push origin main
```

### Step 3: Verify Deployment on EKS
```bash
kubectl get pods -n <K8S_NAMESPACE> -o wide
kubectl get service -n <K8S_NAMESPACE>
kubectl get externalsecret -n <K8S_NAMESPACE>
kubectl logs -f deployment/backstage -n <K8S_NAMESPACE>
```

---

## 10. Troubleshooting & Maintenance Checklist

| Symptom | Primary Cause | Recommended Resolution |
| :--- | :--- | :--- |
| `fatal: ambiguous argument '...^'` in Gitleaks | Shallow git clone | Ensure `fetch-depth: 0` is set in `actions/checkout` in `.github/workflows/ci-cd.yml` |
| `sorry, too many clients already` | PostgreSQL connection pool exhaustion | Ensure `knexConfig.pool.max: 2` in `app-config.production.yaml` |
| `404` on probe check | Invalid healthcheck path | Set probe paths to `/.backstage/health/v1/readiness` and `/.backstage/health/v1/liveness` in `values.yaml` |
| `POSTGRES_PASSWORD` missing | Secret omitted from `envFrom` | Verify `helm/backstage/templates/backstage.yaml` includes `backstage-postgres-secrets` when `externalSecrets.enabled: true` |
