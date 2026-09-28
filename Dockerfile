# Multi-stage Dockerfile for Backstage backend package.
# Stage 1 compiles TypeScript and builds backend bundle inside Docker.
# Stage 2 creates a lightweight production runtime container.

# STAGE 1: Build Environment
FROM node:24-trixie-slim AS build

RUN apt-get update && \
    apt-get install -y --no-install-recommends libsqlite3-dev python3 g++ make && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml ./
COPY --chown=node:node backstage.json ./
COPY --chown=node:node package.json yarn.lock ./
COPY --chown=node:node packages ./packages
COPY --chown=node:node plugins ./plugins

RUN yarn install --immutable

COPY --chown=node:node . ./

RUN yarn tsc
RUN yarn build:backend

# STAGE 2: Production Runtime Environment
FROM node:24-trixie-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libsqlite3-dev && \
    rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /app

COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml ./
COPY --chown=node:node backstage.json ./
COPY --chown=node:node yarn.lock package.json ./

# Copy compiled backend release bundle directly from stage 1 (build stage)
COPY --from=build --chown=node:node /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

ENV NODE_ENV=production

RUN yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

COPY --from=build --chown=node:node /app/packages/backend/dist/bundle.tar.gz ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

COPY --chown=node:node examples ./examples
COPY --chown=node:node app-config*.yaml ./

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
