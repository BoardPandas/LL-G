---
tech: git
tags: [versioning, package-json, rebase, release-process, concurrency, shared-branch, changelog, deploy]
severity: high
---
# An identical version bump vanishes during rebase — and the rebase reports success

## PROBLEM
When your commit and the upstream commit make the **byte-identical** version edit — both moving `package.json` from `2.175.5` to `2.175.6` — `git rebase` recognises your change as already present in the new base and drops it. There is no conflict and no warning. The rebase prints `Successfully rebased and updated refs/heads/main`, and your commit emerges carrying **no version change at all**.

This is the common case, not an exotic one: in a repo whose convention is "every commit bumps at least the patch", two agents branching from the same base will *both* compute `base + 1` and produce the same diff. Identical diffs are exactly what rebase deduplicates.

The result is a commit that violates the repo's own bump rule while looking fine:

- `git log` shows your commit on top of theirs.
- `package.json` on disk reads `2.175.6` — the *correct-looking* number, because their commit set it.
- Your CHANGELOG entry is still there (it lands in a different section, so it merges cleanly).
- Only `git show --stat HEAD` reveals that `package.json` is absent from your commit.

Two traps make it easy to miss:

1. **The success message is the whole problem.** A rejected push or a conflict prompts you to re-check. "Successfully rebased" invites you to push immediately.
2. **The number on disk is plausible.** `grep '"version"' package.json` after the rebase returns a version one higher than your original base, which is exactly what you expected to see. It just belongs to someone else's commit.

Observed 2026-07-29: base `2.175.5`; a concurrent agent pushed a bump to `2.175.6`; the local commit had bumped to `2.175.6` too. The rebase reported success and silently discarded the bump. Amending to `2.175.7` and pushing hit the identical situation again — a third agent had taken `2.175.7` — so the same silent drop repeated on the retry.

## WRONG
```bash
git fetch origin main
git rebase --autostash origin/main
# -> "Successfully rebased and updated refs/heads/main"   (no conflict!)

# The bump looks present, because THEIR commit set it.
grep '"version"' package.json          # -> "version": "2.175.6"   ✅ looks right

git push origin main                   # ships a commit that bumps nothing
```

Equally wrong is fixing it from the value you *staged* rather than from the remote — after a second concurrent push, `2.175.7` is taken too:

```bash
# amends to the number you picked before the rebase; may already be claimed
npm pkg set version="2.175.7"
git commit --amend --no-edit
```

## RIGHT
Re-derive the version from `origin/main` **after** the rebase, and assert your commit actually contains the bump. Loop, because the window reopens on every retry:

```bash
for attempt in 1 2 3 4 5; do
  git fetch --quiet origin main
  git rebase --autostash origin/main || { git rebase --abort; exit 2; }

  # Never trust the staged/remembered value -- read what is on the remote NOW.
  remote=$(git show origin/main:package.json | node -pe \
             'JSON.parse(require("fs").readFileSync(0,"utf8")).version')
  next=$(node -pe "const p='$remote'.split('.'); p[2]=Number(p[2])+1; p.join('.')")

  npm pkg set version="$next"
  git add package.json
  GIT_EDITOR=true git commit --quiet --amend --no-edit

  # The bump is only real if it is IN the commit, not merely on disk.
  git show --stat --format="" HEAD | grep -q 'package\.json' \
    || { echo "BUG: bump not in commit"; exit 1; }

  git push origin main && exit 0
done
exit 1
```

The one-line check that catches it, if you do nothing else:

```bash
git show --stat --format="" HEAD | grep -q 'package\.json' \
  || echo "commit contains no version bump"
```

## NOTES
- **`git show --stat HEAD` is the tell, not `grep package.json`.** The question is "did my *commit* change the version", not "does the file hold a new version". Reading the working tree cannot distinguish your bump from the upstream one.
- **This is the no-conflict sibling of [A version number read at task start is stale by commit time](stale-version-read-collides-on-push.md).** That entry covers the case where the concurrent commit touched *different* lines and a duplicate version merges cleanly. This one is narrower and more deceptive: the edits are the *same* line with the *same* value, so nothing merges — your side is discarded as redundant. Its "RIGHT" recipe (re-derive `CURRENT` from the synced tree) prevents this too; the failure mode is amending from a remembered number and trusting the success message.
- **A CHANGELOG entry surviving proves nothing.** Entries for different changes land in different sections, so the changelog merges cleanly while the version bump — a single shared line — does not. Seeing your changelog text in the rebased commit is not evidence the bump came with it.
- **`--autostash` is the right tool when other agents share the working tree**, but keep the window short: pre-compute the resolution so you are not holding their uncommitted work in a stash while you think. A conflict here should `--abort`, not sit unresolved.
- Repos deriving the version from a tag or CI counter are immune. This is specific to a hand-assigned version committed as a file.
- Same root cause as rebase dropping a cherry-picked commit that already exists upstream (`git rebase` skips patches whose diff is already applied). The version line is where it bites, because it is the one line two independent commits are *guaranteed* to write identically.
