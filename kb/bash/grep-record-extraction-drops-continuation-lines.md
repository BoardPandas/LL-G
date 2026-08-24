---
tech: bash
tags: [grep, sed, awk, text-extraction, refactor, multiline, markdown, silent-truncation, byte-accounting]
severity: high
---
# Extracting records with `grep '^- pattern'` silently drops every continuation line, so a lossy split looks complete

## PROBLEM

Splitting a large file into two (moving a log section into a sibling file, extracting
entries into a database, archiving old records) invites a bullet-anchored grep:

    grep '^- \*\*20' SOURCE.md >> DEST.md

This is correct **only if every record occupies exactly one line**. If any record has
indented continuation lines -- sub-points, wrapped prose, nested lists, code blocks --
grep takes the anchor line and discards the body. It reports success, writes a file,
and the entry count is right, so every cheap check passes:

    grep -c '^- \*\*20' DEST.md    # 12 -- matches the source. Looks perfect.

The trap is that record count is the metric you naturally reach for, and it is exactly
the metric that survives the bug. The dropped content is invisible in it.

It gets worse when the same script is applied across several files: one file's records
genuinely are single-line, so the approach is "validated" on that file and then reused
on a file with a different record shape. The first success is what licenses the second
failure.

If the source is then overwritten in place (`head -n $((START-1)) F > base.md; mv base.md F`),
the continuation lines are gone from the working tree. They survive only in git if the
file was committed -- and any **uncommitted** records are destroyed outright.

## WRONG

```bash
S=$(grep -n '^## Log' F.md | cut -d: -f1)
head -n $((S-1)) F.md > base.md
grep '^- \*\*20' F.md > HISTORY.md      # takes ONLY each record's first line
mv base.md F.md                          # source overwritten; body lines now gone

grep -c '^- \*\*20' HISTORY.md           # 12 == source count -> "verified"
```

## RIGHT

```bash
S=$(grep -n '^## Log' F.md | cut -d: -f1)
head -n $((S-1)) F.md > base.md
tail -n +$((S+1)) F.md > HISTORY.md      # slice the SECTION, not the bullets:
                                          # continuation lines come along by construction

# Byte accounting -- the check that record count cannot fake:
SRC=$(wc -c < F.md); KEPT=$(wc -c < base.md); MOVED=$(wc -c < HISTORY.md)
echo "src=$SRC kept=$KEPT moved=$MOVED delta=$((SRC - KEPT - MOVED))"   # expect ~0

# Line-coverage proof, with a control that must be NON-zero:
grep -vE '^[[:space:]]*$' F.md | sort -u > /tmp/o.lines
cat base.md HISTORY.md | grep -vE '^[[:space:]]*$' | sort -u > /tmp/u.lines
echo "CONTROL found (want $(wc -l < /tmp/o.lines)): $(grep -F -x -f /tmp/u.lines /tmp/o.lines | wc -l)"
echo "MISSING  (want 0): $(grep -F -x -v -f /tmp/u.lines /tmp/o.lines | wc -l)"

mv base.md F.md      # only after both checks pass
```

## NOTES

Prefer **range slicing** (`tail -n +N`, `sed -n 'A,Bp'`, `awk` between markers) over
record-pattern matching whenever records may span lines. Slicing is shape-agnostic;
grep encodes an assumption about record shape that nothing enforces.

**Byte accounting is the cheap detector.** `source_bytes - kept_bytes - moved_bytes`
should be ~0; a large positive residual is content that vanished. In the observed case
32 KB left the source and only 17 KB arrived, while the record count matched exactly --
the arithmetic caught what every count-based check missed. Expect a small non-zero
residual from deliberately-removed headers and, on Windows, from CRLF-vs-LF if one side
came from `git show` (~1 byte per line); reconcile it rather than ignoring it.

Same family as `in-place-edit-no-match-silent-noop.md` (an operation reports success
having done less than you think) and `comm-silent-empty-output-git-bash.md` (pair
should-be-zero assertions with a control that must be non-zero). Here the control is the
line-coverage count: if it reads 0 too, the checker is broken, not the data.

Check the record shape before choosing the tool, per file, not once:
`tail -n +$S F.md | grep -cE '^[[:space:]]+'` -- any non-zero result means continuation
lines exist and a bullet-anchored grep will truncate.

Recovery, in order: `git show HEAD:path` restores committed content; **uncommitted**
records may still exist in an agent/editor session transcript (e.g. Claude Code's
`~/.claude/projects/<slug>/<session>.jsonl`, greppable for a distinctive phrase from the
lost text, which held the full heredoc that originally wrote it). Verify any recovery
with the line-coverage check above rather than eyeballing it.
