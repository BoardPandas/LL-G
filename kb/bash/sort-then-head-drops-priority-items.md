---
tech: bash
tags: [sort, uniq, head, cap, truncation, priority]
severity: medium
---
# `sort -u | head -n N` drops whatever sorts last, not what matters least

## PROBLEM
Capping a mixed list with `sort -u | head -n 100` decides what survives by alphabetical order. When the list is built from sources of different importance (dependency names, then root files, then deeper files), a big repo loses the important items whenever they sort late. Nothing errors and small test repos never reach the cap, so the bug shows up only on the repos where the cap matters.

## WRONG
```bash
{ deps; root_names; deeper_names; } | sort -u | head -n 100
```

## RIGHT
```bash
# Emit in priority order, dedupe keeping first occurrence, then cap.
{ deps; root_names | sort; deeper_names | sort; } | awk 'length($0) > 0 && !seen[$0]++' | head -n 100
```

## NOTES
Test the cap with an input past it, and assert that the high-priority items are still in the output. Found in Roundtable's `rt hook` markers (2026-10-15).
