---
tech: git
tags: [worktree, cherry-pick, stash, concurrent-sessions, shared-working-tree, rebase, merge-conflict, git-add]
severity: high
---
# Concurrent agents on one working tree: isolate your commit in a worktree

## PROBLEM
When two Claude (or human+agent) sessions share ONE git working tree, the other
session running `git stash` / `git pull` / `git rebase` silently mutates YOUR
state: it reverts your uncommitted tracked-file edits, sweeps them into a
*combined* stash (yours + theirs), resets the index mid-stage, and can leave
`package.json` + `CHANGELOG.md` in a `UU` conflict. Symptoms that look like data
loss but aren't: files you just edited revert to HEAD, `package.json` becomes
invalid JSON (conflict markers), and `git status` shows files you never touched.
Naive recovery makes it worse: `git add -A` sweeps the other session's in-flight
edits into your commit, and rebasing the shared branch pushes the other session's
unfinished commit. The work is almost always recoverable from the combined stash
— but the other session may `stash drop` it at any moment.

## WRONG
```bash
# Shared tree; other session is mid-rebase. You try to land your feature:
git add -A                 # sweeps the OTHER session's uncommitted files too
git commit -m "my feature" # commits a mix of both sessions' work
git pull --rebase          # rebases THEIR in-flight commit onto origin as well,
git push                   # ...and pushes it. Their unfinished work is now live.
# Meanwhile your reverted edits sit only in a combined stash the other
# session is about to drop.
```

## RIGHT
```bash
# 1. Back up your work OUTSIDE the repo first (the combined stash may be dropped).
git stash show -p stash@{0} > /c/tmp/backup.patch

# 2. Stage by EXPLICIT PATH, never -A. For a file BOTH sessions edited, stage
#    only your hunk via an extracted single-hunk patch:
git diff path/shared.css > /tmp/all.patch   # then keep only your @@ hunk ->
git apply --cached my-hunk.patch            # ...and apply just that to the index

# 3. To land ONLY your commits — without pushing the other session's in-flight
#    commit or disturbing their live working tree — cherry-pick in an ISOLATED
#    worktree off the freshly-fetched remote tip:
git fetch origin
git worktree add --detach /c/tmp/wt origin/main
cd /c/tmp/wt
git cherry-pick <your-sha-1> <your-sha-2>    # code files apply clean;
GIT_EDITOR=true git cherry-pick --continue   #   resolve CHANGELOG/package.json
git push origin HEAD:main                     # fast-forwards; clean tree also
cd - && git worktree prune                    #   passes the pre-push line-cap hook
# The other session keeps its own commit and pushes it itself; on their next
# pull, git drops your already-merged commits by patch-id and replays only theirs.
```

## NOTES
- The conflicts during cherry-pick are almost always ONLY `CHANGELOG.md` (each
  commit prepends an entry) and `package.json` (the version line). Resolve
  CHANGELOG by keeping BOTH sides in version-descending order; resolve
  package.json with `git checkout --theirs package.json` (in a cherry-pick,
  "theirs" = the commit being picked = yours).
- The isolated worktree's working tree is CLEAN (only your commits), so a
  pre-push line-cap / lint hook that scans the working tree won't trip on the
  other session's oversized *uncommitted* files — no `--no-verify` needed.
- Sibling entry: [Verify the current git branch before committing](../bash/verify-branch-before-commit.md)
  (shared trees can move HEAD under you). Same root cause: never assume you are
  the only writer of a shared working tree.
- The "intentional change since read" notices on files you didn't touch are the
  tell that another session is editing the same tree — stop and back up before
  proceeding.
