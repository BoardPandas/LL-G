---
tech: claude-code
tags: [git, worktree, concurrency, branch, recovery, shared-checkout]
severity: high
---
# A concurrent session can move the branch under you, and it reads as lost work

## PROBLEM

Two Claude Code sessions open on the same repository share one working tree and
one branch pointer. If the other session runs `git checkout` — to look at
`main`, to start its own branch, to pull — your files change underneath you
mid-task.

What that looks like from inside your session is data loss. Code you wrote and
committed minutes ago is gone from the files. `grep` finds nothing.
`git status` is clean, so there is nothing to restore. The harness reports the
files as "modified by the user or a linter" and shows pre-change content, which
reads as confirmation. Every signal agrees that your work was destroyed.

Nothing was destroyed. Your commits are intact on your own branch; only the
checkout moved. But the instinct at that moment — check the branch back out to
get your files back — takes the tree away from the other session mid-task and
turns one confusing situation into two corrupted ones.

## WRONG

```bash
# Files look reverted, git status is clean. Conclude the work is gone and
# "recover" by taking the checkout back.
git checkout my-feature-branch     # yanks the tree out from under the other
                                   # session, which is mid-edit
```

## RIGHT

```bash
# Establish what actually happened before touching anything.
git rev-parse HEAD            # a commit you never made?
git branch --show-current     # someone else's branch?
git reflog -8                 # "checkout: moving from <your-branch> to main"
git log --oneline -5 my-feature-branch   # your commits, still there

# Then take your own tree instead of reclaiming the shared one.
git worktree add /tmp/my-work my-feature-branch
ln -sfn "$PWD/node_modules" /tmp/my-work/node_modules          # fresh worktree
ln -sfn "$PWD/dashboard/node_modules" /tmp/my-work/dashboard/  # has none
cd /tmp/my-work
```

## NOTES

The tell is that `git status` is **clean** while files look reverted. A genuine
revert leaves either modifications or a stash; a checkout by someone else
leaves a consistent tree at a different commit. Clean-and-wrong means you are
looking at another branch, not at damage.

Downstream hazard once you are on your own worktree: a branch cut from an older
base can claim a migration number, fixture id, or version another branch
already took. Runners that apply above a high-water mark skip the loser
silently. Re-check numbering against the other branch and `main` before merging.

Note also that `cd` inside a compound Bash call can persist, so a later
relative path silently resolves against the wrong tree — the same "files are
missing" symptom from a different cause. Use absolute paths when more than one
tree is in play.

Related but distinct: `worktree-agents-miss-uncommitted-work.md` is about
subagents branching from a commit and never seeing your uncommitted changes.
This is the reverse direction — another *session* moving the branch that your
committed work is on.
