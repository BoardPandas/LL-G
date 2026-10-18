---
tech: cloudflare
tags: [d1, meta-changes, triggers, fts5, returning, row-count]
severity: high
---
# D1 meta.changes counts rows written by triggers too

## PROBLEM
On Cloudflare D1, a statement's `meta.changes` includes every row its triggers wrote, not only the rows the statement itself inserted, updated or deleted. SQLite's own `changes()` leaves trigger writes out, so code written to the SQLite contract miscounts on D1. Insert 5 rows into a table whose `AFTER INSERT` trigger keeps an FTS5 external-content index in sync and `meta.changes` is 15; an ordinary trigger that writes one audit row per insert makes it 10. A count check built on it ("did every row land?", "how many did the sweep delete?") breaks as soon as someone adds a trigger, possibly long after the check was written, and nothing errors.

## WRONG
```ts
const r = await db
  .prepare("INSERT INTO entries (slug, body) VALUES (?1, ?2), (?3, ?4), (?5, ?6), (?7, ?8), (?9, ?10)")
  .bind(...values)
  .run();
if (r.meta.changes !== 5) throw new Error("partial insert"); // 15 with an FTS5 sync trigger
```

## RIGHT
```ts
// RETURNING yields one row per row of the target table the statement touched,
// whatever its triggers do.
const { results } = await db
  .prepare("INSERT INTO entries (slug, body) VALUES (?1, ?2), (?3, ?4), (?5, ?6), (?7, ?8), (?9, ?10) RETURNING slug")
  .bind(...values)
  .all();
if (results.length !== 5) throw new Error("partial insert");
```
`UPDATE ... RETURNING id` and `DELETE ... RETURNING id` count the same way.

## NOTES
- Reproduced with wrangler's local D1 (`getPlatformProxy`), 5-row insert: no trigger 5, one audit trigger 10, FTS5 sync trigger 15. `meta.rows_written` (10 in the FTS5 case) is a billing figure and no better a count.
- A statement with `RETURNING` run through `.run()` still reports 15 in `meta.changes` while `results` holds 5 rows: count `results`, not `meta`.
- Each result of `batch()` is inflated the same way.
- `meta.changes > 0` as "something changed" still works; an exact comparison does not.
- Found while syncing an FTS5-indexed knowledge base into D1, where the per-chunk count check saw 15 changes for 5 rows.
