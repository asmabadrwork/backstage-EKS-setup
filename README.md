# Backstage Developer Portal - Production Helm Deployment

This repository contains the production-ready Spotify Backstage Developer Portal, pre-configured for Kubernetes deployment using **Helm**, **Amazon ECR**, **Nginx Ingress**, and **ZeroSSL TLS certificates**.

---

## Table of Contents

1. [Architecture & Features](#architecture--features)
2. [Repository Structure](#repository-structure)
3. [Prerequisites](#prerequisites)
4. [Local Development](#local-development)
5. [Docker Build & ECR Push](#docker-build--ecr-push)
6. [Production Deployment via Helm](#production-deployment-via-helm)
   - [Step 1: Cluster & Ingress Setup](#step-1-cluster--ingress-setup)
   - [Step 2: Create Secrets (ECR, App, ZeroSSL TLS)](#step-2-create-secrets-ecr-app-zerossl-tls)
   - [Step 3: Deploy via Helm](#step-3-deploy-via-helm)
7. [Automated CI/CD Pipeline](#automated-cicd-pipeline)
8. [Helm Values Reference](#helm-values-reference)

---

## Architecture & Features

- **Frontend & Backend**: Unified Backstage release bundle built via Yarn Berry monorepo.
- **Database**: PostgreSQL (Support for in-cluster PostgreSQL with dynamic PV storage or external AWS RDS).
- **Deployment Engine**: Helm 3 Chart with automated resource limits, health probes (`livenessProbe` / `readinessProbe`), and HA replication.
- **Ingress & Security**: Nginx Ingress Controller with custom ZeroSSL TLS certificate support.

---

## Repository Structure

```
.
├── .github/workflows/       # GitHub Actions CI & CD Pipelines (Secret scanning, Build, ECR push, SSH Helm trigger)
├── app-config.yaml          # Base Backstage configuration
├── app-config.production.yaml # Production Backstage overrides (PostgreSQL, Auth, CORS, CSP)
├── Dockerfile               # Root multi-stage Docker build file
├── helm/
│   └── backstage/           # Production Helm Chart
│       ├── Chart.yaml       # Helm metadata
│       ├── values.yaml      # Configurable Helm values (domain, images, replicas, secrets)
│       └── templates/       # Kubernetes manifests (Deployment, Service, Ingress, Secrets, PV/PVC)
├── packages/
│   ├── app/                 # Frontend React Application
│   └── backend/             # Node.js Backend Service
└── README.md
```

---

## Prerequisites

- **AWS EC2 / Kubernetes**: Ubuntu 22.04 / 24.04 server with K3s/EKS and `kubectl`.
- **Package Managers**: `helm` (v3+), `docker` (v20+), `aws-cli` (v2+).
- **Domain & SSL**: Domain pointing to server IP (e.g. `backstage.example.com`) and ZeroSSL certificates.

---

## Local Development

```bash
# Install dependencies
yarn install

# Start local development server
yarn start
```

---

## Docker Build & ECR Push

Before deploying to Kubernetes, build and push the container image to Amazon ECR:

```bash
# 1. Login Docker to AWS ECR
aws ecr get-login-password --region <AWS_REGION> | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com

# 2. Build Release Artifacts & Docker Container
yarn install --immutable
yarn tsc
yarn build:backend
docker build -t <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/backstage:latest .

# 3. Push Image to ECR
docker push <AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/backstage:latest
```

---

## Production Deployment via Helm

### Step 1: Cluster & Ingress Setup

Install Nginx Ingress Controller (if not already installed):

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx \
  --create-namespace \
  --set controller.service.type=LoadBalancer
```

---

### Step 2: Create Secrets (ECR, App, ZeroSSL TLS)

Create required secrets:

```bash
# 1. Create AWS ECR Image Pull Secret
kubectl create secret docker-registry ecr-secret \
  --docker-server=<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com \
  --docker-username=AWS \
  --docker-password=$(aws ecr get-login-password --region <AWS_REGION>) \
  --namespace backstage \
  --create-namespace

# 2. Combine ZeroSSL Certificates & Create TLS Secret
# (Assuming you have certificate.crt, ca_bundle.crt, and private.key)
cat certificate.crt ca_bundle.crt > fullchain.crt

kubectl create secret tls backstage-tls \
  --cert=fullchain.crt \
  --key=private.key \
  --namespace backstage
```

---

### Step 3: Deploy via Helm

Run `helm upgrade --install` to deploy or update Backstage:

```bash
helm upgrade --install backstage ./helm/backstage \
  --namespace backstage \
  --create-namespace \
  --set domain="<YOUR_DOMAIN>" \
  --set backstage.image.repository="<AWS_ACCOUNT_ID>.dkr.ecr.<AWS_REGION>.amazonaws.com/backstage" \
  --set backstage.image.tag="latest" \
  --set postgres.enabled=false \
  --set postgres.host="<AWS_RDS_ENDPOINT>.ap-south-1.rds.amazonaws.com" \
  --set postgres.user="backstage" \
  --set postgres.password="<YOUR_POSTGRES_PASSWORD>" \
  --set postgres.ssl=true \
  --set secrets.githubToken="<YOUR_GITHUB_TOKEN>" \
  --set secrets.backendSecret="<YOUR_BACKEND_SECRET>"
```

#### Verify Deployment Status:

```bash
# Check Pods
kubectl get pods -n backstage

# Check Ingress & Service
kubectl get svc,ingress -n backstage

# Check Application Logs
kubectl logs -f deployment/backstage -n backstage
```

---

## Automated CI/CD Pipeline

Continuous deployment is handled automatically via GitHub Actions in [.github/workflows/cd.yml](.github/workflows/cd.yml).

### Required GitHub Repository Secrets

Configure the following secrets in GitHub Repository **Settings -> Secrets and variables -> Actions**:

| Secret Name | Description |
| :--- | :--- |
| `AWS_ACCESS_KEY_ID` | AWS Access Key for ECR build & push. |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Key for ECR build & push. |
| `EC2_HOST` | Public IP of your EC2 server. |
| `EC2_SSH_KEY` | Private SSH key (`.pem`) for `ubuntu` user. |

---

## Helm Values Reference

Key values in [helm/backstage/values.yaml](helm/backstage/values.yaml):

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `domain` | `example.com` | Production domain name used by Ingress. |
| `backstage.replicaCount` | `2` | Number of Backstage backend replicas (HA). |
| `backstage.image.repository` | `<AWS_ACCOUNT_ID>.dkr.ecr...` | Container image repository. |
| `backstage.image.tag` | `1.0.0` | Container image tag. |
| `postgres.enabled` | `true` | Set to `false` if using external AWS RDS PostgreSQL. |
| `postgres.createSecret` | `true` | Set to `false` if managing postgres secret outside Helm. |
| `tls.enabled` | `true` | Enables TLS / HTTPS in Ingress. |
| `tls.secretName` | `backstage-tls` | Kubernetes Secret containing ZeroSSL certificate. |
# backstage-EKS-setup
