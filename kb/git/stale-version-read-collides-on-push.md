---
tech: git
tags: [versioning, changelog, package-json, rebase, release-process, concurrency, shared-branch, deploy]
severity: high
---
# A version number read at task start is stale by commit time

## PROBLEM
In a repo that hand-assigns a version per commit (package.json + a CHANGELOG heading, often the commit subject too), the natural workflow is: read the current version while surveying the code, do the work, then commit `current + 1`. On a shared branch that read is a snapshot of a mutable ref, and any push that lands during your working session invalidates it.

Observed: a version was chosen at task start; three commits landed on `main` over the next ~40 minutes; one had already taken the exact number being assigned. `git push` was rejected, and the rebase conflicted in both `CHANGELOG.md` and `package.json`.

**The rejection is the lucky case, not the defining one.** Git only objects when the concurrent commit touched the same lines. If the other commit appended to an *existing* CHANGELOG section (or never touched `package.json`), both changes merge cleanly and the push succeeds — leaving two commits in history that claim the same version, with no conflict, no error, and no failing gate. A version that no longer uniquely identifies a build is discovered much later, typically while trying to map a running deploy back to a commit and finding two candidates.

Two aggravating factors:

1. **The number is usually written in three places** — `package.json`, the CHANGELOG heading, and (in many repos) the commit subject. Resolving the conflict in the two *files* still leaves the subject stale, and nothing validates a commit subject. A pre-commit changelog hook does not help: it checks that CHANGELOG.md is staged, not that the number in it is unclaimed.
2. **Auto-deploy raises the cost.** Where push-to-main deploys, the version is what operators read to identify what is running.

## WRONG
```bash
# ── early in the session, while surveying the repo ────────────────
grep '"version"' package.json          # -> 3.334.1.0
# ...40 minutes of work; three commits land on origin/main...

# ── commit time: reuses the number read at the start ─────────────
# 3.334.2.0 was claimed by someone else 8 minutes ago.
sed -i 's/3.334.1.0/3.334.2.0/' package.json
git commit -m "fix(alert): ... (3.334.2.0)"
git push origin main                   # rejected -- or worse, silently accepted
```

## RIGHT
```bash
# ── commit time: re-read AFTER syncing with the remote ───────────
git fetch origin main
git rebase origin/main                 # resolve any conflicts first

# Derive the number from the just-synced tree, never from memory.
CURRENT=$(node -p "require('./package.json').version")
NEXT=$(echo "$CURRENT" | awk -F. '{print $1"."$2"."$3"."$4+1}')   # build bump

# Assert it is genuinely unclaimed before spending it.
grep -q "^## \[$NEXT\]" CHANGELOG.md && { echo "$NEXT already in changelog"; exit 1; }
git log --oneline | grep -F "($NEXT)"  && { echo "$NEXT already shipped"; exit 1; }

# Write all three sites from that ONE read.
npm pkg set version="$NEXT"
# ...prepend the "## [$NEXT]" CHANGELOG section...
git add CHANGELOG.md package.json
git commit -m "fix(alert): ... ($NEXT)"
```

After any rebase that renumbers, re-check every site the version appears in — the commit subject is the one git will not flag:

```bash
test "$(node -p "require('./package.json').version")" = \
     "$(git log -1 --pretty=%s | grep -oP '\(\K[0-9.]+(?=\)$)')" \
  || echo "MISMATCH: package.json and commit subject disagree"
```

## NOTES
- **Ordering is the whole fix.** Choosing the version is the *last* step before `git commit`, after `fetch`/`rebase` — not part of the initial survey. Any gap between the read and the commit is the window.
- **A rejected push is a gift.** Treat it as a prompt to re-derive the version, not merely to rebase and retry. Re-running `git push` after a conflict-free rebase is exactly how a duplicate version reaches `main`.
- **Conflict resolution is not renumbering.** Taking "theirs" for their section and "yours" for yours produces a syntactically clean CHANGELOG with a duplicate heading. Renumber your section, then re-sync package.json and the commit subject to match.
- A `--amend` to fix only the subject will trip a pre-commit changelog hook that inspects the *staged* set (the changelog is already inside the commit, so nothing is staged). Most such hooks ship a documented bypass for this case; confirm the changelog really is in the commit with `git show --stat HEAD` before using it.
- Repos that derive the version from a tag or a CI counter are immune. This applies specifically to the hand-assigned Major.Minor.Patch.Build convention where a human or agent picks the next number.
- Related: [Concurrent agents on one working tree](concurrent-shared-tree-worktree.md) — same root cause (a shared mutable ref read optimistically), different blast radius.
