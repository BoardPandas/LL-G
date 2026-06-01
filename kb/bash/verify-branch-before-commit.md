---
tech: bash
tags: [git, branch, commit, parallel-agents, worktree, safety]
severity: medium
---
# Verify the current git branch right before committing (parallel agents move it)

## PROBLEM
When more than one agent/process shares a working tree, the checked-out branch can
change underneath you between commits. A `git checkout` (or branch-creating
operation) run by a parallel agent silently moves `HEAD`, so your next `git commit`
lands on the wrong branch. The commit succeeds with no error; you only notice later
that `origin/<your-feature>` is behind and your work is on a different ref. The
analogous trap: `git push origin <branch>` reports "Everything up-to-date" because
the LOCAL ref named `<branch>` is not the branch `HEAD` currently points at.

## WRONG
```bash
# ... work, then commit assuming you are still on your branch ...
git add src/foo.ts
git commit -F .git/MSG.txt        # may land on whatever branch HEAD now points to
git push origin feature/my-branch # "Everything up-to-date" -- pushes the wrong ref
```

## RIGHT
```bash
test "$(git rev-parse --abbrev-ref HEAD)" = "feature/my-branch" \
  || { echo "On wrong branch: $(git rev-parse --abbrev-ref HEAD)"; exit 1; }
git add src/foo.ts
git commit -F .git/MSG.txt
git push origin HEAD               # push the commit you just made, not a named ref
git rev-parse --short HEAD origin/feature/my-branch origin/main  # verify ancestry
```

## NOTES
Recovery when a commit lands on the wrong branch but is still an ancestor of the
intended target: `git merge --ff-only <target>` to reconcile, then push. Best
prevention for true parallelism is a separate git worktree per agent so each has
its own HEAD. Always re-`git fetch` and re-check fast-forward before pushing a
shared branch like main.
