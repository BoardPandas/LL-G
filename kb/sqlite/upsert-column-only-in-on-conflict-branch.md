---
tech: sqlite
tags: [upsert, on-conflict, insert, seed, fixtures, d1]
severity: high
---
# A column set only in the ON CONFLICT branch of an upsert is left at its default on first insert

## PROBLEM
An upsert written by extending an existing INSERT tends to gain new columns only in the `DO UPDATE SET` list. The statement is valid and re-running it works, so it looks correct. On the FIRST run there is no conflict, the UPDATE branch never executes, and the new column keeps its default. A seed script that marks a row revoked, disabled or expired this way creates it live, and only a second run fixes it.

## WRONG
```sql
INSERT INTO resources (id, status, published_at)
VALUES ('fixture-revoked', 'published', 1700000000)
ON CONFLICT(id) DO UPDATE SET status = 'published', revoked_at = 1700000000;
-- first run: revoked_at IS NULL -> the "revoked" row is live
```

## RIGHT
```sql
INSERT INTO resources (id, status, published_at, revoked_at)
VALUES ('fixture-revoked', 'published', 1700000000, 1700000000)
ON CONFLICT(id) DO UPDATE SET status = excluded.status, revoked_at = excluded.revoked_at;
```

## NOTES
- Use `excluded.<col>` in the UPDATE so the two branches cannot drift.
- Verify a seed against an EMPTY table, then read the row back; a re-run hides this.
