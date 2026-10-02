---
tech: pnpm
tags: [pnpm, pnpm-12, docker, frozen-lockfile, workspace, monorepo, deploy, ci]
severity: high
---
# pnpm 12.8 rejects a frozen install when a Docker layer copies only some workspace manifests

## PROBLEM
A common Docker cache pattern copies the lockfile, `pnpm-workspace.yaml` and *some*
workspace `package.json` files, then runs `pnpm install --frozen-lockfile` before
`COPY . .`. If the image doesn't need a workspace package, its manifest often gets left out.

pnpm 12.5.1 tolerated a lockfile importer whose manifest was absent. **pnpm 12.8.1
does not**, and the build fails:

```
Error: ERR_PNPM_OUTDATED_LOCKFILE
  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up
  to date with package.json.
    Failure reason:
    the lockfile records `importers["forge-bridge"]`, but that project's
    directory or package.json is missing
```

**Why this is silent until deploy:** every local and CI gate runs in a full checkout,
where every manifest exists. Lint, build, typecheck, tests and a bare
`pnpm install --frozen-lockfile` all pass. Only the Docker build sees the partial layout,
so the deploy job fails after verify is green. The error says "not up to date" and
suggests regenerating the lockfile, but the lockfile is correct. What's actually missing
is a manifest in the build layer.

Seen 2026-10-01 in BoardPandas/tcg: a patch-and-minor dependency bump plus pnpm
12.5.1 -> 12.8.1 broke the API image. The dashboard image already copied all five
manifests and built fine.

## WRONG
```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY dashboard/package.json dashboard/
COPY proxy-pipeline/package.json proxy-pipeline/
# forge-bridge and rules-engine are in the lockfile but not copied
RUN pnpm install --frozen-lockfile --ignore-scripts
```

## RIGHT
```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# EVERY package listed in pnpm-workspace.yaml `packages:`, not just the ones this image builds
COPY dashboard/package.json dashboard/
COPY proxy-pipeline/package.json proxy-pipeline/
COPY forge-bridge/package.json forge-bridge/
COPY rules-engine/package.json rules-engine/
RUN pnpm install --frozen-lockfile --ignore-scripts
```

Reproduce and verify without Docker by copying only that layer's files into a scratch
directory, then running the same install offline:

```bash
R=$(mktemp -d); mkdir -p "$R/dashboard" "$R/proxy-pipeline"
cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$R/"
cp dashboard/package.json "$R/dashboard/"; cp proxy-pipeline/package.json "$R/proxy-pipeline/"
(cd "$R" && pnpm install --frozen-lockfile --ignore-scripts --offline)   # fails on 12.8
```

## NOTES
- Check every Dockerfile when you bump pnpm, not only the `corepack prepare` lines.
  Grep each `RUN pnpm install` layer and compare its `COPY */package.json` lines with
  `pnpm-workspace.yaml`.
- A `--filter <pkg>...` install still needs every importer's manifest on disk.
- Best confirmation before pushing: build each image locally (podman works).
- Seen again 2026-10-02 in BoardPandas/supportforge-platform: the admin and portal images skipped
  `packages/rmm-contracts/package.json`. Railway failed both builds while every GitHub CI job stayed
  green, because CI's `next build` jobs build from the checkout and never go through the Dockerfiles.
  A green CI is no evidence here.
- Enforce it rather than remembering: supportforge-platform's `scripts/check-dockerfile-manifests.mjs`
  reads `pnpm-workspace.yaml` `packages:`, then fails any tracked Dockerfile whose frozen-install stage
  has not copied the root and every project manifest (from the build context, not `--from=`, before
  the `RUN`). It fails closed on a workspace glob it cannot expand, and when no Dockerfile runs a
  frozen install at all, so it cannot pass while guarding nothing. Node built-ins only, so it fits an
  install-free CI job.
- Related: [v12-lockfile-pins-the-package-manager.md](v12-lockfile-pins-the-package-manager.md),
  which covers the other pnpm-12 bump hazard that also fails only in CI and Docker.
