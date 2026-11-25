---
tech: git
tags: [git, branch, cleanup, rebase, cherry]
severity: medium
---
# git branch -d succeeding does not prove the work is on main

## PROBLEM
git branch -d refuses only when the branch is merged into neither HEAD nor its upstream. A pushed feature branch is always merged into its own upstream, so -d succeeds (with a warning) even if main never received it, and work that was rebased onto main under new SHAs is indistinguishable from work that was never landed.

## WRONG
```bash
git branch -d feature/x   # "deleted" -> assume it was on main
```

## RIGHT
```bash
git cherry -v origin/main feature/x   # "-" = patch already upstream
# for "+" lines, compare the touched files against origin/main before deleting
```

## NOTES
A rebased branch shows "+" for commits whose patch changed during conflict resolution; compare content, not SHAs.
