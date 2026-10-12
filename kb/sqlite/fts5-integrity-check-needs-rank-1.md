---
tech: sqlite
tags: [fts5, external-content, integrity-check, triggers, d1, testing]
severity: high
---
# FTS5 integrity-check ignores the content table unless rank is 1

## PROBLEM
For an external-content FTS5 table (`content='messages'`), `INSERT INTO f(f) VALUES('integrity-check')` only checks that the index is consistent with itself. It passes even when the DELETE trigger handed FTS5 the wrong old values in its `'delete'` row, leaving stale tokens indexed. Only `INSERT INTO f(f, rank) VALUES('integrity-check', 1)` compares the index with the content table, and that fails with `SQLITE_CORRUPT_VTAB` ("fts5: checksum mismatch"). A test using the first form proves nothing about the triggers. Probed on Cloudflare D1 under Miniflare.

## WRONG
```sql
-- Passes even with a broken 'delete' trigger
INSERT INTO messages_fts (messages_fts) VALUES ('integrity-check');
```

## RIGHT
```sql
INSERT INTO messages_fts (messages_fts, rank) VALUES ('integrity-check', 1);
```

## NOTES
- The external-content DELETE trigger must pass exactly the indexed values: `INSERT INTO f(f, rowid, cols...) VALUES('delete', old.rowid, old.cols...)`.
- Also assert by query: after a delete, `MATCH` on each indexed word returns nothing.
