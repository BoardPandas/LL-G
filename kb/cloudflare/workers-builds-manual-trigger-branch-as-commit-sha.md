---
tech: cloudflare
tags: [workers-builds, ci, versioning]
severity: medium
---
# A manual Workers Builds run sets WORKERS_CI_COMMIT_SHA to the branch name

## PROBLEM
Build-time version stamps commonly read WORKERS_CI_COMMIT_SHA. Push-triggered builds set it to the commit hash, but a manual build triggered with only a branch fills it with the branch name, so /api/version (and any stale-client check comparing it) reports `main`.

## WRONG
```ts
const ci = process.env.WORKERS_CI_COMMIT_SHA;
if (ci) return ci.slice(0, 12); // "main" on a manual build
```

## RIGHT
```ts
const ci = process.env.WORKERS_CI_COMMIT_SHA;
if (ci && /^[0-9a-f]{7,40}$/i.test(ci)) return ci.slice(0, 12).toLowerCase();
return execSync("git rev-parse --short=12 HEAD").toString().trim();
```
