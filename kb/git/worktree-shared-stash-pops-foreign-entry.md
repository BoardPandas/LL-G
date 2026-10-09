---
tech: git
tags: [git, stash, worktree, concurrency, agents, multi-session]
severity: high
---
# Worktrees do not isolate git stash: refs/stash is shared, so a pop can take another session's entry

## PROBLEM
Every worktree of a repository shares one `refs/stash`. Isolating sessions in
separate worktrees (see `concurrent-shared-tree-worktree.md`) isolates working
trees and HEADs, but not the stash list. A `git stash push` followed later by
`git stash pop` in one worktree pops whatever entry is on top. If another session
stashed in between, you pop *their* entry. Their uncommitted work lands in your tree
and their entry disappears from the list. Your own entry stays on top, where *their*
next `git stash pop` applies your changes to their tree.

Nothing reports an error. Observed 2026-10-09 in supportforge-platform:
1. 13:29:13: a worktree stashed its work to run a clean-tree baseline.
2. 13:31:40: another session ran `git stash push -u` in the main checkout.
3. The worktree's `git stash pop --index` then applied the other session's
   36 files to the wrong tree.

## WRONG
```bash
# "Quick clean-tree baseline" in a repo other sessions also use
git stash push -m my-wip
pnpm run check:hooks          # minutes pass; another session stashes here
git stash pop --index         # pops THEIR entry, not yours
```

## RIGHT
```bash
# Option A: never touch the shared list. Baseline in a throwaway worktree.
git worktree add "$TMP/baseline" origin/main
(cd "$TMP/baseline" && pnpm run check:hooks)
git worktree remove "$TMP/baseline"

# Option B: if a stash is unavoidable, keep it off refs/stash and apply by SHA.
sha=$(git stash create)          # records the stash commit, does NOT push to the list
git reset --hard -q              # clean tree (stash create leaves it dirty)
pnpm run check:hooks
git stash apply --index "$sha"   # by SHA, never by position
# (`git stash create` skips untracked files; commit them or use Option A)
```

## NOTES
- **Recovery.** A popped or dropped entry survives as a dangling commit. Run
  `git fsck --no-reflogs --unreachable | awk '/commit/{print $3}'` and pass the
  results to `git log --no-walk --format='%h %ci %s'`. Look for subjects of the form
  `On <branch>: <msg>`; `untracked files on ...` holds the `-u` part. Restore your
  own work by SHA: `git checkout <sha> -- <paths>`.
- **Removing your own entry.** Do it so nobody pops it later, and resolve its position
  by SHA right before dropping:
  `i=$(git log -g --format='%gd %H' refs/stash | awk -v s=$sha '$2==s{print $1}'); git stash drop "$i"`.
  The race window is milliseconds, not minutes.
- **Before deleting a foreign copy from your tree,** compare it with the owner's
  checkout. Here the owner had restored its work and kept editing, so 4 of the 37
  files in their tree were newer than the popped snapshot.
- **Related:** `concurrent-shared-tree-worktree.md`. Worktree isolation is the right
  fix for working-tree races, but this entry is the gap it leaves.
