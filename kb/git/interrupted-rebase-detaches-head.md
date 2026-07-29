---
tech: git
tags: [rebase, detached-head, worktree, concurrent-agents, reflog, reset-hard]
severity: high
---
# An interrupted rebase leaves HEAD detached, and your next commit lands on no branch

## PROBLEM

A second session (a spawned/background agent, a parallel terminal) starts
`git rebase origin/main` in the **same working tree** and is interrupted before
it finishes. `rebase` detaches HEAD as its very first step, so the tree is now
sitting on a detached HEAD -- and it does not look unusual: the files are all
there, and the tree can be perfectly clean.

You then commit. Git accepts it and prints:

```
[detached HEAD 342c7bf] Untrack the leftover scratch files
```

That is one word different from the `[main 342c7bf]` you expect, in output
nobody reads closely. The commit is real and complete, but **no branch points at
it**. `git push origin main` then pushes nothing -- `main` never moved -- and
reports "Everything up-to-date", which reads as success. Come back later, run
`git status`, and the tree is clean with the work apparently gone.

The evidence-destroying part: if you run `git reset --hard <ref>` while that
rebase is pending -- the natural move to "get a clean base" -- it **clears
`.git/rebase-merge`**. Afterward there is no in-progress-operation state left to
detect, so the usual check comes back negative:

```console
$ ls .git/rebase-merge .git/rebase-apply
ls: cannot access '.git/rebase-merge': No such file or directory
```

The only surviving trace is the reflog:

```console
$ git reflog -3
342c7bf HEAD@{0}: commit: Untrack the leftover scratch files
f05479e HEAD@{1}: rebase (start): checkout origin/main     <-- the smoking gun
e62b3a7 HEAD@{2}: commit: ...
```

## WRONG

```bash
# Another session left a rebase half-finished. HEAD is already detached and
# nothing on screen says so.
git reset --hard origin/main      # ALSO wipes .git/rebase-merge -- evidence gone
# ...make the edits...
git add -A
git commit -m "Untrack the leftover scratch files"
# [detached HEAD 342c7bf] ...        <-- looks like [main 342c7bf]; not read
git push origin main
# Everything up-to-date              <-- "success". main never moved.
```

## RIGHT

```bash
# 1. Refuse to work in a tree that is detached or mid-operation.
git symbolic-ref -q HEAD >/dev/null || { echo "HEAD is detached -- stop"; exit 1; }
for s in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD BISECT_LOG; do
  [ -e ".git/$s" ] && { echo "operation in progress (.git/$s) -- stop"; exit 1; }
done

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || { echo "on '$branch', expected main -- stop"; exit 1; }

# 2. Commit, then assert the BRANCH moved -- not just that a commit exists.
git commit -m "Untrack the leftover scratch files"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "$branch")" ] \
  || { echo "commit landed off '$branch' -- recover with: git checkout -B $branch $(git rev-parse --short HEAD)"; exit 1; }
```

Recovery once it has already happened -- the commit is fine, only the ref is
missing, so point the branch at it and reattach:

```bash
git checkout -B main <detached-sha>
```

## NOTES

The root cause is two agents sharing one working tree. Prefer an isolated
worktree per agent (`isolation: worktree`, `git worktree add`); the guard above
is the fallback for when you cannot control how the other session was launched.

`git status` DOES say `HEAD detached at ...` on its first line -- but the trap is
that you typically do not run it between the other session's interruption and
your own commit, and every other signal (clean tree, present files, accepted
commit, successful push) reads normal.

Related, and deliberately distinct:

- [Concurrent agents on one working tree](concurrent-shared-tree-worktree.md)
  covers the same root cause destroying **uncommitted** edits. This entry is the
  mirror image: the commit succeeds and is then **orphaned**, so recovery is a
  ref update rather than a patch replay.
- [A version number read at task start is stale by commit time](stale-version-read-collides-on-push.md)
  and [An identical version bump vanishes during rebase](rebase-drops-identical-version-bump.md)
  are what the interrupted rebase was usually trying to resolve -- expect these
  three to co-occur in one incident.

Observed 2026-07-29 on BoardPandas/Hark: a spawned background task ran in the
parent checkout instead of a worktree, its rebase was interrupted, and the
follow-up commit landed detached. Caught only by reading the `[detached HEAD ...]`
prefix in the commit output.
