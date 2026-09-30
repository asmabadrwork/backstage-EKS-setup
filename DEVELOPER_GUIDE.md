# Developer Guide: Backstage Repository Change Workflow & CI/CD Operations

This document explains how developers contribute code changes to this **Spotify Backstage** repository, where specific application components reside, how to branch and commit changes, and how the automated **GitHub Actions CI/CD pipeline** processes changes.

---

## Table of Contents
1. [Repository Monorepo Structure & Code Locations](#1-repository-monorepo-structure--code-locations)
2. [Git Commit & Branching Workflow](#2-git-commit--branching-workflow)
3. [How the CI/CD Pipeline Works](#3-how-the-cicd-pipeline-works)

---

## 1. Repository Monorepo Structure & Code Locations

This repository is organized as a Yarn monorepo. When modifying features or configurations, refer to the following directory layout:

```text
.
├── packages/
│   ├── app/                   # Frontend React Application (UI components, pages, catalog views, themes)
│   └── backend/               # Backend Node.js Service (Auth plugins, catalog engine, search, scaffolder)
├── helm/
│   └── backstage/             # Helm Chart (Kubernetes Deployment, Ingress, Secrets, ServiceAccount manifests)
├── examples/                  # Catalog Entities & Software Template Definitions
├── .github/workflows/
│   └── ci-cd.yml              # GitHub Actions CI/CD Pipeline definition
├── app-config.yaml            # Base Backstage application configuration
├── app-config.production.yaml # Production deployment configuration overrides
├── Dockerfile                 # Multi-stage production container build file
└── PRODUCTION_DEPLOYMENT_GUIDE.md # Production Infrastructure & EKS Setup Guide
```

### Where to make changes:

| Component / Task | Location in Repository |
| :--- | :--- |
| **Frontend UI, Pages & Navigation** | `packages/app/src/` |
| **Backend Plugins & API Modules** | `packages/backend/src/` |
| **Auth Providers & OIDC Config** | `packages/backend/src/index.ts` & `app-config.production.yaml` |
| **Software Templates & Catalog Data** | `examples/template/` & `examples/entities.yaml` |
| **Kubernetes / Helm Manifests** | `helm/backstage/` |
| **CI/CD Pipeline Configuration** | `.github/workflows/ci-cd.yml` |

---

## 2. Git Commit & Branching Workflow

1. Create a dedicated feature branch off `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/add-new-template
   ```

2. Make your code or configuration modifications in the appropriate package.

3. Commit changes with a descriptive message:
   ```bash
   git add .
   git commit -m "feat(catalog): add software template for microservices"
   ```

4. Push the branch to GitHub:
   ```bash
   git push origin feature/add-new-template
   ```

5. Create a **Pull Request (PR)** against `main` on GitHub.

---

## 3. How the CI/CD Pipeline Works

The GitHub Actions workflow defined in [`.github/workflows/ci-cd.yml`](file:///c:/Users/lenovo/Downloads/backstage-EKS-setup/.github/workflows/ci-cd.yml) automatically handles all testing, security scanning, container building, and Kubernetes deployment:

```text
[ Developer Pushes Code ]
           │
           ├──► Pull Request (PR) ──► STAGE 1: CI Verification (Gitleaks, Lint, Typecheck, Test, Config)
           │                          (NO DEPLOYMENT EXECUTED)
           │
           └──► Push / Merge to 'main' ──► STAGE 1: CI Verification
                                              │
                                              ▼
                                          STAGE 2: Build Release Bundle
                                              │
                                              ▼
                                          STAGE 3: Docker Build & ECR Push (AWS OIDC Auth)
                                              │
                                              ▼
                                          STAGE 4: Helm Deploy to EKS (SSM Tunnel)
```

### 3.1 On Pull Request (PR)
When a PR is opened or updated, the pipeline automatically runs **Stage 1 (CI Verification)**:
- **Secret Scanning (Gitleaks)**: Scans full git commit history (`fetch-depth: 0`) to verify no plain text tokens or credentials exist in code.
- **Linting**: Runs formatting and code style verification (`yarn backstage-cli repo lint`).
- **Typechecking**: Validates strict TypeScript compilation (`yarn tsc:full`).
- **Unit Testing**: Executes Jest test suites (`yarn backstage-cli repo test`).
- **App Config Check**: Validates syntax for `app-config.yaml` and `app-config.production.yaml`.

> **Note**: Pull Requests do **not** trigger container builds or deployments to EKS.

### 3.2 On Push / Merge to `main`
When changes are merged into `main`, all 4 stages execute automatically:
1. **Stage 1 (CI Verification)**: Reruns automated quality and security checks.
2. **Stage 2 (Build Release Bundle)**: Compiles frontend and backend bundles (`yarn build:all`).
3. **Stage 3 (Docker Build & ECR Push)**: Authenticates to AWS via OIDC role `github-actions-eks-deploy`, builds multi-stage Docker container image, and pushes tag `${{ github.sha }}` to Amazon ECR.
4. **Stage 4 (Helm Deploy to EKS)**: Opens an AWS SSM Session Manager tunnel to EC2 Bastion (`i-0effba6ccca9f949f`), connects to private EKS control plane (`dev-negd-eks`), updates Helm release `backstage` in namespace `backstage`, and verifies pod rollout status.
