---
tech: sqlite
tags: [unique-constraint, error-messages, testing, d1]
severity: low
---
# A row that breaks two UNIQUE constraints reports only the one SQLite checks first

## PROBLEM
A duplicate insert that violates both `principals.id` (PRIMARY KEY) and `principals.token_hash` (UNIQUE) fails with `UNIQUE constraint failed: principals.token_hash`, not the `id` constraint the test is about. Which one is named depends on the order SQLite checks the indexes, so an assertion on the constraint name breaks, or is satisfied by the wrong constraint.

## WRONG
```ts
// the fixture duplicates every column
await expect(insertPrincipal(existing)).rejects.toThrow("UNIQUE constraint failed: principals.id");
```

## RIGHT
```ts
// Violate only the constraint under test...
await expect(insertPrincipal({ ...existing, token_hash: freshHash() })).rejects.toThrow(
  "UNIQUE constraint failed: principals.id",
);
// ...or assert only that a UNIQUE constraint on the table refused it.
await expect(insertPrincipal(existing)).rejects.toThrow(/UNIQUE constraint failed: principals\./);
```

## NOTES
- Seen on Cloudflare D1 and the sqlite3 CLI, 2026-10-12.
