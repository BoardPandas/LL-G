---
tech: bash
tags: [comm, git-bash, windows, msys, verification, set-comparison, silent-failure, grep, locale]
severity: high
---
# `comm` can return empty output for every pair, so a set-diff verification passes without comparing anything

## PROBLEM

`comm -12 a.txt b.txt` is the idiomatic way to prove two id sets overlap (or do not) before committing a destructive batch operation. Under Git Bash on Windows it was observed returning **empty output for every input pair**, including pairs with a known-large intersection, and including after `LC_ALL=C` was applied to both the `sort` and the `comm`.

This is dangerous specifically because the usual way people use `comm` in a safety check is inverted: the checks are written as "this should be **0**".

```
KEEP ids leaked into archive batch (want 0): 0   # looks like a pass
KEEP ids leaked into delete batch  (want 0): 0   # looks like a pass
archive/delete overlap             (want 0): 0   # looks like a pass
```

Every assertion "passes" while nothing was ever compared. A guard built entirely from should-be-zero checks cannot distinguish clean data from a checker that emits nothing, and it fails **open** -- it green-lights the batch.

The classic `comm` failure mode (input not sorted in the collation order `comm` expects, which normally prints `comm: file 1 is not in sorted order` to stderr) is a related hazard, but here no diagnostic appeared and `LC_ALL=C` did not help. The root cause was not isolated. That is exactly the point: **you cannot rely on noticing that `comm` broke.** Treat this as a tool that can silently produce nothing on this platform, and design the check so that silence is detectable.

Two defenses matter, and the second is the general one:

1. Use `grep -F -x -f`, which compares fixed whole lines with no sort, collation, or locale dependency, and needs no pre-sorted input.
2. **Always include a control assertion that is supposed to be NON-zero.** If the should-be-19 check and the should-be-0 checks all report 0, no data hypothesis explains that, but "the checker is broken" explains all of them at once. Without a control, a broken checker is indistinguishable from a clean result.

Base64-ish opaque ids (mixed case, `-`, `_`, `=`) are the common payload for this kind of check, and are precisely the strings where locale collation and byte order disagree.

## WRONG

```bash
# All assertions are "should be zero" -- a checker that outputs nothing passes them all.
sort  generated-archive-ids.txt > /tmp/gen.txt
sort  keep-ids.txt              > /tmp/keep.txt

leaked=$(comm -12 /tmp/gen.txt /tmp/keep.txt | wc -l)
echo "keep ids leaked into archive batch (want 0): $leaked"

[ "$leaked" -eq 0 ] && send_destructive_batch    # fires even when comm compared nothing
```

## RIGHT

```bash
# grep -F -x -f: fixed strings, whole line, no sort/collation/locale dependency.
# Note the CONTROL check -- the one that must be non-zero.

gen=generated-archive-ids.txt
tsv_arch=archive-ids.txt
tsv_keep=keep-ids.txt

expected=$(wc -l < "$tsv_arch")
matched=$(grep -F -x -f "$tsv_arch" "$gen" | wc -l)   # CONTROL: must equal $expected
leaked=$( grep -F -x -f "$tsv_keep" "$gen" | wc -l)   # SAFETY:  must be 0

echo "archive ids matching source (want $expected): $matched"
echo "keep ids leaked into batch  (want 0):         $leaked"

if [ "$matched" -ne "$expected" ]; then
  echo "FAIL: control check did not match -- the CHECKER is broken, not necessarily the data" >&2
  exit 1
fi
[ "$leaked" -eq 0 ] || { echo "FAIL: keep id in destructive batch" >&2; exit 1; }

send_destructive_batch
```

## NOTES

- Discovered 2026-08-05 verifying a Microsoft Graph `$batch` of mail moves/deletes: the id round-trip check reported `0` for the should-be-19 control and `0` for all three should-be-zero leak checks. The generated batch bodies were in fact correct; `grep -F -x -f` confirmed 19/2/0/0 immediately. Nothing was sent until a working check passed.
- Two wrong hypotheses were chased first: MSYS path mangling (see `msys-path-conversion-corrupts-jq-arg.md`, a real and separate bug that produces the *same* empty-readback symptom) and CRLF line endings. The CRLF was genuinely present -- the Claude Code Bash tool writes heredocs with CRLF on Windows -- so `tr -d '\r'` your generated TSV before parsing regardless. Neither was the cause here.
- Generalizes past `comm`: any verification whose passing state is "no output" needs a companion assertion whose passing state is "specific non-zero output". Same family as `in-place-edit-no-match-silent-noop.md`, where a no-op edit exits 0.
- If you want to keep `comm`, at minimum check its stderr and assert the control count; do not consume only its stdout line count.
