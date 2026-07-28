---
name: pnpm overrides need an exact version to force re-resolution (pnpm v10 only)
description: On pnpm v10, range-style overrides do not force re-resolution -- a vulnerable transitive stays locked on the bad version unless the override pins to an exact version. Does NOT apply to pnpm v11, where ranges DO re-resolve and overrides live in pnpm-workspace.yaml; check `pnpm --version` first.
type: gotcha
tech: typescript
tags: [pnpm, dependencies, security, vite, lockfile, pnpm-v10]
severity: high
---
# pnpm overrides need an exact version to force re-resolution (pnpm v10 only)

> **Version scope: pnpm v10.** On **pnpm v11 this entry does not apply** -- range overrides DO force re-resolution, and overrides moved out of package.json into `pnpm-workspace.yaml` (a `pnpm.overrides` block there is silently ignored). Run `pnpm --version` before applying any of the below, and see [../pnpm/v11-overrides-workspace-yaml-and-ranges.md](../pnpm/v11-overrides-workspace-yaml-and-ranges.md) for v11.

## PROBLEM

A vulnerable transitive dependency (for example, vite less than or equal to 8.0.4 reached via vitest greater than vite, GHSA-v2wj-q39q-566r and GHSA-p9ff-h696-f583) will not move off the bad version even after adding `pnpm.overrides` and reinstalling. `pnpm why vite` keeps showing the original locked version. `pnpm install --force` does not help. Deleting `pnpm-lock.yaml` and running `pnpm install` does not help either.

Root cause: pnpm v10 treats range-style overrides (for example, `"vite": ">=8.0.5"`) as a peer-dep-style constraint, not as a forced re-resolution directive. The lockfile records the override range correctly but the resolver still picks the originally-locked exact version. Only an EXACT version override (for example, `"vite": "8.0.10"`) triggers actual re-resolution.

## WRONG

```jsonc
// package.json -- DOES NOT WORK
{
  "pnpm": {
    "overrides": {
      "vite": ">=8.0.5"
    }
  }
}
```

After `rm pnpm-lock.yaml && pnpm install`, `pnpm why vite` still shows the old version.

## RIGHT

```jsonc
// package.json -- WORKS
{
  "pnpm": {
    "overrides": {
      "vite": "8.0.10"
    }
  }
}
```

Then run `rm pnpm-lock.yaml && pnpm install` to regenerate the lockfile. Verify with `pnpm why vite` and `pnpm audit`.

## NOTES

Verified on pnpm 10.33.2 against vitest 4.1.5 (peer-dep `vite >=8.0.5`).

**Superseded on pnpm v11** by [../pnpm/v11-overrides-workspace-yaml-and-ranges.md](../pnpm/v11-overrides-workspace-yaml-and-ranges.md): v11 reads overrides only from `pnpm-workspace.yaml` (package.json's `pnpm.overrides` is silently ignored -- install succeeds, lockfile unchanged), and range overrides there DO force re-resolution. Applying this entry's advice on v11 wastes time in exactly the wrong place, because the symptom (override appears not to take) is identical while the cause is the ignored file.

Tradeoff: exact pinning means you have to bump it manually when patches roll. That is acceptable for security-driven overrides; for ergonomics-driven overrides reconsider whether to override at all rather than committing to manual bumps.
