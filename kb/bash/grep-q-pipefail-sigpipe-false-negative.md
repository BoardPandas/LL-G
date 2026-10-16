---
tech: bash
tags: [pipefail, sigpipe, grep, github-actions, ci, deploy]
severity: high
---
# Piping into `grep -q` under pipefail turns a match into a miss once the input is large

## PROBLEM
`grep -q` exits at its first match. If the writer (`echo`, `cat`, `git diff`) is still writing because the input is bigger than the pipe buffer (~64 KB), it is killed by SIGPIPE and exits 141. Under `set -o pipefail` (GitHub Actions' default bash is `-eo pipefail`) the pipeline's status is that 141, so `if ... | grep -q` takes the ELSE branch on a MATCH. Small inputs fit in the buffer and work, so it passes every test and fails only on the big day.

Incident (BoardPandas/tcg, 2026-10-15): a deploy filter `echo "$CHANGED" | grep -Eq "$PATTERN"` saw a 2,244-file push, printed "no deploy-relevant changes -> skip deploy", and production stayed stale until a manual dispatch. Reproduced: `PIPESTATUS` was `141 0`.

## WRONG
```bash
set -euo pipefail
CHANGED="$(git diff --name-only "$BEFORE" "$SHA")"
if echo "$CHANGED" | grep -Eq "$PATTERN"; then deploy=true; else deploy=false; fi
```

## RIGHT
```bash
set -euo pipefail
CHANGED="$(git diff --name-only "$BEFORE" "$SHA")"
if grep -Eq "$PATTERN" <<<"$CHANGED"; then deploy=true; else deploy=false; fi
```

## NOTES
Same trap for any early-exiting reader (`head`, `grep -m1`, `awk 'NR==1{exit}'`) behind a pipe under pipefail, including `yes | head`. Use a here-string, a file, or drop `-q` and redirect to /dev/null. Reproduce with a few thousand lines, never a short fixture. A filter that cannot decide should fail toward the safe action, not silently skip.
