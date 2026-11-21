---
tech: pnpm
tags: [pnpm, corepack, node-26, node-25, docker, github-actions, ci, upgrade, packagemanager]
severity: medium
---
# Node 25+ no longer bundles corepack, so `corepack enable` fails in Node 26 images and CI

## PROBLEM
Corepack stopped shipping with Node.js in v25. A repo that pins pnpm through the `packageManager`
field and runs `corepack enable` works on Node 24 and breaks the moment the runtime moves to
Node 26: the official `node:26-slim` image, `actions/setup-node` with Node 26, and distro Node 26
packages all lack the `corepack` binary. The failure lands in the Dockerfile and CI, not on the
developer machine that already has pnpm installed some other way, so a local `pnpm install` and
test run stay green while every image build fails.

## WRONG
```dockerfile
FROM node:26-slim AS base
RUN corepack enable            # corepack: not found
```

## RIGHT
```dockerfile
FROM node:26-slim AS base
# Node 25+ no longer bundles corepack; install it from npm, pinned.
RUN npm install -g corepack@0.36.0 && corepack enable
```
```yaml
# GitHub Actions: before setup-node, whose `cache: pnpm` needs the pnpm shim on PATH.
- name: Enable corepack
  run: npm install -g corepack@0.36.0 && corepack enable
- uses: actions/setup-node@<sha> # v7.1.0
  with:
    node-version: "26"
    cache: "pnpm"
```

## NOTES
- corepack 0.36.0 was verified to resolve and run pnpm 12.21.0 on Node 26.13 (it downloads the
  native pnpm binary). Older corepack releases have been reported failing on pnpm 12.
- The `packageManager` field stays the single source of the pnpm version; only the corepack
  version is now pinned at each install site. Grep for `corepack enable` across Dockerfiles,
  workflows and README setup steps and update them in the same change as the Node bump.
- Developers on Node 26 need the same one-time `npm i -g corepack@0.36.0 && corepack enable`.
- Related: [v12-lockfile-pins-the-package-manager.md](v12-lockfile-pins-the-package-manager.md)
  -- bump the pnpm pin and the lockfile together.
