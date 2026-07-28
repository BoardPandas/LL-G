---
tech: claude-code
tags: [ll-g, knowledge-base, index, parsing, add-lesson, silent-wrong-output, counting]
severity: medium
---
# LL-G index bullet format is not uniform — one regex silently counts zero entries

## PROBLEM
The LL-G tech indexes (`kb/<tech>/llms.txt`) look uniform but are not. Almost all use:

    ## Entries

    - [Full Title Of Entry](slug.md): one-line description. HIGH.

`kb/ninjaone/llms.txt` uses a different shape **and** carries a count in its header:

    ## Entries (7)

    - HIGH [slug.md](slug.md): one-line description

So the obvious way to count entries before updating the master index returns a confident, wrong answer:

```
$ grep -c '^- \[' kb/ninjaone/llms.txt
0
```

Zero. Not an error, not empty — the file has seven entries. Anything downstream that trusts that number writes `(0 entries)` into the master index, or decides the file needs initialising and clobbers it. A census makes the outlier obvious:

    powershell     "- [Title]"=23   "- SEV [file]"=0    header=## Entries
    windows        "- [Title]"=9    "- SEV [file]"=0    header=## Entries
    supportforge   "- [Title]"=8    "- SEV [file]"=0    header=## Entries
    graph-api      "- [Title]"=40   "- SEV [file]"=0    header=## Entries
    claude-code    "- [Title]"=7    "- SEV [file]"=0    header=## Entries
    ninjaone       "- [Title]"=0    "- SEV [file]"=7    header=## Entries (7)   <-- outlier

## WRONG
```bash
# counts only the majority format; returns 0 for ninjaone
n=$(grep -c '^- \[' "kb/$tech/llms.txt")
# ...then writes "($n entries)" into the master index
```
```bash
# appends the majority format into a file that uses the other one,
# leaving the index internally inconsistent and the header count stale
printf -- '- [%s](%s): %s. %s.\n' "$title" "$slug" "$desc" "$sev" >> "kb/$tech/llms.txt"
```

## RIGHT
```bash
f="kb/$tech/llms.txt"

# 1. Count BOTH shapes and use the sum. Never trust a single pattern.
a=$(grep -c '^- \[' "$f")                                  # - [Title](slug.md):
b=$(grep -c '^- \(HIGH\|MEDIUM\|LOW\) \[' "$f")            # - HIGH [slug.md](slug.md):
n=$(( a + b ))
[ "$n" -gt 0 ] || { echo "ABORT: parsed 0 entries from $f - format changed?"; exit 1; }

# 2. Append in the format THIS file already uses, not your preferred one.
if [ "$b" -gt 0 ]; then
  printf -- '- %s [%s](%s): %s\n' "$sev" "$slug" "$slug" "$desc" >> "$f"
else
  printf -- '- [%s](%s): %s. %s.\n' "$title" "$slug" "$desc" "$sev" >> "$f"
fi

# 3. If the header carries a count, update it too - it is a second source of truth.
grep -q '^## Entries (' "$f" && sed -i "s/^## Entries (.*)/## Entries ($n)/" "$f"

# 4. Reconcile: the master index count must equal the actual bullet count.
```

## NOTES
- **Guard on zero.** A count of 0 from a KB index that demonstrably has content means your parser is wrong, not the file. Failing loudly there is what turns this from a silent corruption into a one-line fix.
- `## Entries (N)` in ninjaone is a **second place the count lives**. Adding an entry there without bumping the header leaves the file self-contradicting even if the master index is right.
- Verify counts against the live files after pushing, not against what you intended to write. Master-index drift is real and pre-existing: `graph-api` was once recorded as 30 in the master while the index held 32 bullets.
- Edit the master index **line-anchored**, asserting exactly one match for `kb/<tech>/llms.txt`. A bare `s/(7 entries)/(8 entries)/` over the whole file hits whichever tech happens to appear first — that mistake silently bumped Tailwind's count while leaving Windows untouched.
- Related: [Line-count budgets on CLAUDE.md are silently gamed by long lines](line-budgets-gamed-by-long-lines.md) — same theme, a plausible metric that stops measuring what you think it measures.
