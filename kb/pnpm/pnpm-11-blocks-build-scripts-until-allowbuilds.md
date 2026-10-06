---
tech: pnpm
tags: [pnpm, install, build-scripts, supply-chain]
severity: medium
---
# pnpm 11+ blocks dependency build scripts until allowBuilds permits them

## PROBLEM
A fresh pnpm 11/12 install of a Vite/Wrangler project fails or produces broken binaries because build scripts are ignored by default. Separately, the default minimumReleaseAge means `pnpm add x@latest` can resolve the previous release, which surprises anyone pinning to a just-published version.

## WRONG
```yaml
# pnpm-workspace.yaml
packages: ["."]
```

## RIGHT
```yaml
# pnpm-workspace.yaml
packages: ["."]
allowBuilds:
  esbuild: true
  workerd: true
```
