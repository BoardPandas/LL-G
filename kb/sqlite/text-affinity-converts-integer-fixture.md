---
tech: sqlite
tags: [type-affinity, text, blob, test-fixtures, d1, zod, false-green]
severity: medium
---
# A TEXT column stores a written integer as text, so a "wrong type" fixture is not wrong

## PROBLEM
A column with TEXT affinity converts a numeric value to text on write: `UPDATE sessions SET repo = 42` stores the string `'42'` (`typeof(repo)` is `text`). A test that means to corrupt a TEXT column with the wrong type, to drive a row-validation error path, corrupts nothing: the read returns `"42"`, `z.string()` accepts it, and the error path is never reached.

## WRONG
```sql
-- meant to make SessionRow.parse() throw
UPDATE sessions SET repo = 42 WHERE id = 's-1';   -- stored as '42'; parses fine
```

## RIGHT
```sql
UPDATE sessions SET repo = X'01' WHERE id = 's-1'; -- a BLOB is never converted to TEXT
```

## NOTES
- Confirm the fixture took before asserting on the error: `SELECT typeof(repo) FROM sessions WHERE id = 's-1'` should return `blob`.
- Same behaviour on Cloudflare D1. Verified 2026-10-12.
