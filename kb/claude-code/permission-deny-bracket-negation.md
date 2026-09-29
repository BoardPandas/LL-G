---
tech: claude-code
tags: [permissions, deny, settings-json, glob, secrets, env-files]
severity: high
---
# Permission deny patterns treat bracket negation as a literal set, so a carve-out exposes secrets

## PROBLEM
You want agents to read a names-only `.env.example` while `Read(**/.env.*)` keeps every real
`.env.*` file denied. Deny beats allow, so an allow rule cannot carve it out, and the obvious
alternative is to narrow the deny rule with gitignore-style bracket negation. The permission
matcher does NOT honour `[!x]` or `[^x]` as negation: it reads them as a literal character set
(`[!e]` = `!` or `e`). The "exception" silently turns into "almost nothing is denied".

Measured 2026-09-28 (BoardPandas/tcg): with the ladder below, `.env.local`, `.env.production`
and `.env.bak` became READABLE, while `.env.enc` and `.env.exp` stayed denied, which fits the
literal-set reading exactly. `[^e]` behaved the same way.

Two things make the test itself misleading:
- `settings.json` edits reload with a lag of roughly 20-25 s, so a Read right after saving is
  judged by the OLD rules, and an already-read file can return a cached "unchanged" result.
- Project `**/` rules only match paths inside the project; a dummy file in a scratch dir
  outside the repo is readable under any rule and proves nothing.

## WRONG
```json
"deny": [
  "Read(**/.env)",
  "Read(**/.env.[!e]*)",
  "Read(**/.env.e[!x]*)",
  "Read(**/.env.ex[!a]*)",
  "Read(**/.env.example?*)"
]
```

## RIGHT
```json
"deny": [
  "Read(**/.env)",
  "Read(**/.env.*)"
]
```
Keep the broad rule and let `.env.example` stay unreadable; derive env-var facts from the code
that reads them (`grep process.env`, deploy scripts). To test any permission-rule change: save,
wait ~25 s, create FRESH file names inside the repo, and check both directions (what must now be
readable AND what must still be denied).

## NOTES
Related: a sibling of "hook matcher only matches tool names" -- permission syntax is its own
small language, not gitignore, and failures in it are silent.
