---
tech: bash
tags: [cat, line-numbers, citations, agents, documentation, grep, awk]
severity: high
---
# `cat -n` over several files numbers lines continuously, so per-file line citations are wrong

## PROBLEM
`cat -n a.ts b.ts c.ts` concatenates first and numbers afterwards, so line numbering runs on across file boundaries instead of restarting at 1 for each file. An agent that reads several files in one call and then cites `b.ts:248-252` gets numbers offset by the length of every earlier file. Some land past end-of-file, which is detectable; the rest stay in range and point at the wrong lines, which nothing flags. In one documentation run, one page had 41 citations past end-of-file (`args.ts:248-319` for an 80-line file) and its in-range citations were offset too. A second agent made the same mistake in the same run.

## WRONG
```bash
# One read, three files: b.ts starts at line (lines in a.ts + 1), not line 1
cat -n src/a.ts src/b.ts src/c.ts
```

## RIGHT
```bash
# Numbering that restarts for each file and names the file on every line
awk '{ printf "%s:%d: %s\n", FILENAME, FNR, $0 }' src/a.ts src/b.ts src/c.ts
# or: grep -n '' src/a.ts src/b.ts src/c.ts     (prints file:line:text)
# or: one `cat -n` (or one Read tool call) per file
```

## NOTES
- `awk`'s `NR` has the same problem as `cat -n`. Use `FNR`, which restarts for each file.
- Check generated citations with a script before trusting them: every `#Lx-Ly` must fall inside its file, and each quoted snippet must appear at its cited lines. A range check alone misses the in-range offsets.
