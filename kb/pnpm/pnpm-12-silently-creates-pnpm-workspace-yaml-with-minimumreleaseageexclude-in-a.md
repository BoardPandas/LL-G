---
tech: pnpm
tags: [minimumReleaseAge, minimumReleaseAgeExclude, pnpm-workspace, ignore-workspace, supply-chain, lockfile]
severity: high
---
# pnpm 12 silently creates pnpm-workspace.yaml with minimumReleaseAgeExclude in a standalone nested package

## PROBLEM
Running `pnpm install` in a standalone nested package (its own lockfile, installed with `--ignore-workspace`, no `pnpm-workspace.yaml` of its own) can silently create a new `pnpm-workspace.yaml` there, listing every just-resolved version that is younger than the default `minimumReleaseAge` under `minimumReleaseAgeExclude`.

Nothing is printed about it. The install reports success and the file shows up only as an untracked file. If it gets committed, two things break at once. The nested package becomes its own workspace root, which changes how every later pnpm command run there resolves config. And the listed versions (here a same-day `vite@8.3.7`, `rolldown@1.2.18` and 15 `@rolldown/binding-*` packages) are exempt from the release-age supply-chain gate for good. The trigger is ordinary: raising a caret range (`vite: ^8.3.5`) to pick up a security fix while a newer patch was published hours earlier.

## WRONG
```bash
cd packages/nested-frontend
sed -i 's/"vite": "\^8.3.1"/"vite": "^8.3.5"/' package.json
pnpm install --ignore-workspace     # resolves vite 8.3.7, published today
git add -A                          # sweeps in the new pnpm-workspace.yaml
git commit -m "Bump vite"
```

## RIGHT
```bash
cd packages/nested-frontend
sed -i 's/"vite": "\^8.3.1"/"vite": "^8.3.5"/' package.json
# Resolve only to versions at least 7 days old
pnpm install --ignore-workspace --config.minimum-release-age=10080
git status --short                  # look for a new pnpm-workspace.yaml
rm -f pnpm-workspace.yaml           # if one appeared from an earlier install
pnpm install --ignore-workspace --frozen-lockfile   # prove the lockfile stands alone
git add package.json pnpm-lock.yaml
```

## NOTES
- Seen on pnpm v12.15.0. The file stays after later installs that no longer need the exclusions, so a clean later install does not remove it.
- A later `--config.minimum-release-age=...` install resolved `^8.3.5` to 8.3.5 and still left the earlier file in place. Delete it by hand.
- Stage named files, never `git add -A`, after any install in a nested package.
- Related: `pnpm/run-verifies-deps-against-workspace-root` (the same nested-package setup) and `pnpm/v12-lockfile-pins-the-package-manager`.
