# Spotify Backstage - Production Deployment on AWS EKS

This repository contains the enterprise-grade production deployment setup for **Spotify Backstage Developer Portal** on **AWS Elastic Kubernetes Service (EKS)** with **Keycloak 26.x OIDC Single Sign-On (SSO)**, **Amazon RDS PostgreSQL**, **AWS Secrets Manager**, **External Secrets Operator (ESO)**, **Amazon ECR**, and **Nginx Ingress Controller with TLS encryption**.

---

## Documentation Guides

- **Master Production Deployment Guide**: [PRODUCTION_DEPLOYMENT_GUIDE.md](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/PRODUCTION_DEPLOYMENT_GUIDE.md) (IAM Roles, AWS Secrets Manager, Keycloak OIDC, EKS setup)
- **Developer Guide**: [DEVELOPER_GUIDE.md](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/DEVELOPER_GUIDE.md) (Local development, monorepo structure, PR verification, CI/CD workflow)

---

## Production Architecture & Technology Stack

```text
[ Users / Developers ]
         │ (HTTPS / 443)
         ▼
[ AWS Load Balancer (NLB) ]
         │
         ▼
[ Nginx Ingress Controller (TLS Termination) ]
         │ (HTTP / 7007)
         ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Amazon EKS Cluster                                                     │
│                                                                        │
│  [ Backstage Deployment ] ◄──► [ ServiceAccount: external-secrets-sa ] │
│   └── Pod 1 (Node Pool: dev-negd-ng-db)                                │
│                                                                        │
│  [ External Secrets Operator (ESO) ]                                   │
│   └── SecretStore (IRSA Role) ◄──► AWS Secrets Manager                │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    │ (Encrypted TLS / Port 5432)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Amazon RDS for PostgreSQL (Multi-AZ)                                   │
│   ├── Primary Writer                                                   │
│   └── Synchronous Standby Replica                                      │
└────────────────────────────────────────────────────────────────────────┘
```

### Core Technologies
- **Application**: Spotify Backstage (React UI + Node.js Backend Engine)
- **Authentication**: Keycloak 26.x OpenID Connect (OIDC) Single Sign-On
- **Runtime**: Node.js 22 LTS & Yarn Berry Monorepo
- **Kubernetes**: AWS EKS Cluster (`dev-negd-eks` in region `ap-south-1`)
- **Database**: Amazon RDS for PostgreSQL (SSL encrypted)
- **Secrets Management**: AWS Secrets Manager (`production/backstage`) synced via External Secrets Operator
- **Ingress**: Nginx Ingress Controller
- **CI/CD**: GitHub Actions using native AWS OIDC authentication (Zero static credentials)

---

## Repository Structure

```text
.
├── .github/workflows/
│   └── ci-cd.yml              # CI/CD: Gitleaks scan, Typecheck, Lint, Test, ECR push, and Helm EKS deploy via AWS OIDC
├── helm/
│   └── backstage/             # Production Helm Chart
│       ├── Chart.yaml         # Chart metadata
│       ├── values.yaml        # Helm default values (nodeSelector, tolerations, probes)
│       └── templates/
│           ├── backstage.yaml # Deployment & Service manifest
│           ├── external-secrets.yaml # ExternalSecrets SecretStore & ExternalSecret
│           ├── ingress.yaml   # Nginx Ingress manifest
│           └── serviceaccount.yaml # IRSA ServiceAccount manifest
├── packages/
│   ├── app/                   # Frontend React Single-Page Application
│   └── backend/               # Backend Node.js Service (Catalog, Scaffolder, TechDocs, Search)
├── app-config.yaml            # Base Backstage configuration
├── app-config.production.yaml # Production overrides (Knex pool max: 2, RDS SSL, OIDC Auth)
├── Dockerfile                 # Multi-stage production Dockerfile
├── PRODUCTION_DEPLOYMENT_GUIDE.md # Master production deployment guide
└── README.md
```

---

## Quick Reference

- **Master Deployment Guide**: [PRODUCTION_DEPLOYMENT_GUIDE.md](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/PRODUCTION_DEPLOYMENT_GUIDE.md)
- **AWS Secrets Manager Secret**: `production/backstage`
- **Kubernetes Namespace**: `backstage`
- **Database Pool Setting**: `knexConfig.pool.max: 2` (in `app-config.production.yaml`)
- **ServiceAccount**: `external-secrets-sa` (annotated with IRSA Role)
