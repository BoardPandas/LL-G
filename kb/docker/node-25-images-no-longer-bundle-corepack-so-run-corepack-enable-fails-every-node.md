---
tech: docker
tags: [nodejs, node26, corepack, pnpm, alpine, railway, ci]
severity: high
---
# Node 25+ images no longer bundle corepack, so `RUN corepack enable` fails every node:26 build

## PROBLEM
Node 25 and later (including the `node:26-alpine` LTS image) no longer ship corepack, so a Dockerfile that runs `RUN corepack enable` fails with `/bin/sh: corepack: not found` (exit 127).
It is not obvious because bumping `FROM node:24-alpine` to `node:26-alpine` looks like a one-line runtime change, local dev on Node 24 still has corepack, and CI jobs that use `setup-node` + `pnpm/action-setup` never touch corepack. If CI does not build the Dockerfiles, CI goes green and only the deploy platform (e.g. Railway) fails, every service at once, within seconds of the build starting. The old deployment keeps serving, so the only signal is a "production is serving this commit" check timing out.

## WRONG
```dockerfile
FROM node:26-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
```

## RIGHT
```dockerfile
FROM node:26-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node 25+ no longer bundles corepack; install it from npm first.
RUN npm install -g corepack@0.36.0 && corepack enable
```

## NOTES
- Pin the corepack version like any other build dependency; 0.36.0 declares `node >=26`.
- The rest of a corepack flow (`corepack prepare pnpm@<ver> --activate`) is unchanged.
- Verify a Node major bump by building every Dockerfile locally (`podman build -f <file> .`) when CI does not build images. See pnpm/pnpm-12-8-partial-workspace-manifests-in-docker for the same "only the deploy platform sees it" gap.
- Docs that say "pnpm ships with Node via Corepack" are wrong for Node 25+; tell developers to `npm install -g corepack` first.
