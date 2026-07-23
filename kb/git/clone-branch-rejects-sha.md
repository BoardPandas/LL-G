---
tech: git
tags: [git, clone, fetch, sha, shallow-clone, sparse-checkout, set-e, silent-failure, bash]
severity: medium
---
# `git clone --branch <ref>` rejects a commit SHA (silent under set -e)

## PROBLEM
`git clone --branch "$REF"` only accepts a **branch or tag name**. Passing a
bare 40-char commit SHA fails with exit 128:

```
fatal: Remote branch <sha> not found in upstream origin
```

This is a trap for any script that pins to an exact commit for reproducibility
(e.g. `FORGE_REF=<sha>`), because a branch/tag works and a SHA does not, so it
passes review and breaks only when someone actually pins a SHA.

It gets worse under `set -euo pipefail` when the clone's output is redirected
away (`>/dev/null 2>&1`): the script dies **silently** the moment the clone
fails -- right after the last thing it echoed -- with no error on screen and the
real work (the ingest/build that was supposed to follow) never runs. It reads
like a hang or a no-op, not a failure. This bit a corpus-refresh script: only the
"sparse-cloning..." line printed, then nothing, and the target data was left
untouched.

## WRONG
```bash
set -euo pipefail
# Fails with exit 128 when $REF is a commit SHA; the 2>&1 >/dev/null hides the
# fatal, so under `set -e` the script just stops here with no visible error.
git clone --filter=blob:none --no-checkout --depth 1 --branch "$REF" \
  https://github.com/OWNER/REPO.git "$WORK/repo" >/dev/null 2>&1
git -C "$WORK/repo" sparse-checkout init --cone >/dev/null
git -C "$WORK/repo" sparse-checkout set "$SUBPATH" >/dev/null
git -C "$WORK/repo" checkout "$REF" >/dev/null 2>&1
```

## RIGHT
```bash
set -euo pipefail
# init + fetch + checkout FETCH_HEAD resolves a branch, tag, OR bare SHA
# identically. GitHub serves any reachable SHA via uploadpack.allowAnySHA1InWant,
# so `git fetch --depth 1 origin <sha>` works. Keep it compatible with shallow +
# partial (blob:none) + sparse cone. Do NOT redirect stderr to /dev/null -- a bad
# ref must fail loudly, not vanish under set -e.
git init -q "$WORK/repo"
git -C "$WORK/repo" remote add origin https://github.com/OWNER/REPO.git
git -C "$WORK/repo" sparse-checkout init --cone >/dev/null
git -C "$WORK/repo" sparse-checkout set "$SUBPATH" >/dev/null
git -C "$WORK/repo" fetch -q --filter=blob:none --depth 1 origin "$REF"
git -C "$WORK/repo" checkout -q FETCH_HEAD
# git rev-parse HEAD now yields the concrete SHA (works for branch/tag/SHA input)
RESOLVED_REF="$(git -C "$WORK/repo" rev-parse HEAD)"
```

## NOTES
- `git checkout FETCH_HEAD` leaves you in detached HEAD at the fetched commit, so
  `git rev-parse HEAD` gives the concrete SHA even when the input was a moving
  branch -- useful for stamping the exact ref you ingested/built.
- Fetching an arbitrary SHA relies on the server allowing it. GitHub does
  (`allowAnySHA1InWant`); some self-hosted remotes disable it, in which case only
  branch/tag names or advertised refs are fetchable.
- The same init+fetch+checkout pattern is what `git clone --branch` workarounds
  use in Dockerfiles that pin a build to a SHA.
- Second, independent lesson: never `2>&1 >/dev/null` a clone/fetch under
  `set -e`. The exit code still aborts the script, but you throw away the one
  message that tells you why -- turning a hard failure into an apparent hang.
- Related: [Verify the current git branch before committing](../bash/verify-branch-before-commit.md).
