---
tech: pnpm
tags: [minimumReleaseAge, minimumReleaseAgeExclude, supply-chain, pnpm-workspace, install]
severity: high
---
# Installing a release younger than `minimumReleaseAge` makes pnpm write an exclusion for it instead of failing

## PROBLEM
With a minimum release age policy in force, adding a dependency whose newest release is too young does not fail the install. pnpm resolves the new release, installs it, and appends it to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`:

```
Added 1 entry to minimumReleaseAgeExclude in pnpm-workspace.yaml
  vite@8.4.0
```

That is one line in a long install log. The effect is that the policy has been waived for exactly the release it exists to hold back, and the waiver is now a committed line that looks deliberate in review. In the case that prompted this entry the release had been published the same day.

## WRONG
```jsonc
// package.json
"vite": "^8.4.0"          // newest, published today
```
```yaml
# pnpm-workspace.yaml, after `pnpm install` -- written by pnpm, not by you
minimumReleaseAgeExclude:
  - vite@8.4.0
```

## RIGHT
```jsonc
// Pin to a release old enough to pass the policy.
"vite": "~8.3.8"
```
```bash
npm view vite time --json | tail -5      # check publish dates before choosing a range
git diff pnpm-workspace.yaml             # after every install that adds a dependency
```

## NOTES
- Remove the exclusion block pnpm wrote, change the range, and install again; the block does not go away on its own.
- Setting `minimumReleaseAgeStrict: true` makes pnpm ask instead of writing the exclusion.
- A tilde range on the previous minor keeps patch updates while staying behind the newest minor.
- Related: pnpm creating the same key in a nested standalone package (`pnpm-12-silently-creates-pnpm-workspace-yaml-with-minimumreleaseageexclude-in-a.md`).
