---
tech: claude-code
tags: [claude-md, context-budget, line-count, bytes, doc-sync]
severity: high
---
# Line-count budgets on CLAUDE.md are silently gamed by long lines

## PROBLEM
A "keep this file under N lines" rule on CLAUDE.md (or any always-loaded prose/config file) measures nothing once content gets appended as ever-longer single lines. The file stays "compliant" while its real cost (bytes, therefore tokens loaded into every session) grows unbounded. Observed in production: a CLAUDE.md at 179 lines (under its 200-line budget) weighing 37.5 KB, with twelve single lines of 1,000 to 3,345 characters, costing roughly 10k tokens of context per session. The failure is silent because the stated metric keeps passing while the actual problem compounds.

## WRONG
```markdown
## Context Management
- Keep this file under 200 lines.
```
Combined with a doc-sync habit of appending each completed feature's full summary as one giant bullet line.

## RIGHT
```markdown
## Context Management
- Keep this file under 10 KB (wc -c). Budget by bytes, not lines; long lines still cost context.
```
And direct detail downward: full feature docs live in `docs/features/X.md`; CLAUDE.md gets a 3-to-4-line pointer entry per module. Verify after every edit:
```bash
wc -c CLAUDE.md   # must stay under 10240
```

## NOTES
Root cause is usually a doc-sync ritual that appends feature summaries upward into the always-loaded file. Fix the ritual (detail flows down, pointers flow up), not just the number. Related: the Vigilis plan `tasks/file-size-ratchet-and-claude-md-diet.md` cut 37.5 KB to 10.2 KB with zero information loss by moving facts into per-feature docs first.
