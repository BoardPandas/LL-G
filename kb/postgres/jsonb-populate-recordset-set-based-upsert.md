---
tech: postgres
tags: [upsert, on-conflict, jsonb, bulk-insert, node-pg, parameters]
severity: medium
---
# Set-based upsert of a typed row set with jsonb_populate_recordset

## PROBLEM
A per-item upsert loop (one round trip per row, rewriting every row) was about 21% of production WAL. Passing a whole row set as one parameter with `unnest` needs a cast per column and breaks on `text[]` columns (no arrays of arrays). `jsonb_populate_recordset(NULL::<table>, $n)` reads a JSON array back as the table's own row type, so `text[]`, `jsonb`, `bigint` and `timestamptz` get their real types with no cast table and no 65535-parameter limit. Four traps:
- node-pg serializes a JS array as a Postgres array literal, so you must `JSON.stringify` it yourself.
- Parameters in an `INSERT ... SELECT` select-list resolve as `text`, so an uncast `$1` fails on a uuid column.
- A repeated conflict key fails with "ON CONFLICT DO UPDATE command cannot affect row a second time".
- Without a WHERE guard, unchanged rows are still rewritten.

## WRONG
```ts
for (const item of items) {
  await tx.query(`INSERT INTO t (device_id, item_key, a, b) VALUES ($1,$2,$3,$4)
    ON CONFLICT (device_id, item_key) DO UPDATE SET a = EXCLUDED.a, b = EXCLUDED.b`, [...]);
}
```

## RIGHT
```ts
const byKey = new Map(items.map((i) => [i.itemKey, i]));  // last report of a key wins
const rows = [...byKey.values()].map((i) => ({ item_key: i.itemKey, a: i.a, b: i.b }));
await tx.query(
  `INSERT INTO t AS stored (device_id, item_key, a, b)
   SELECT $1::uuid, r.item_key, r.a, r.b
     FROM jsonb_populate_recordset(NULL::t, $2::jsonb) AS r
   ON CONFLICT (device_id, item_key) DO UPDATE SET a = EXCLUDED.a, b = EXCLUDED.b
   WHERE (stored.a, stored.b) IS DISTINCT FROM (EXCLUDED.a, EXCLUDED.b)`,
  [deviceId, JSON.stringify(rows)],
);
```

## NOTES
A TEMP table with the same name also shadows the composite type, so `NULL::t` resolves to it. That lets the real SQL run against `CREATE TEMP TABLE t (LIKE public.t INCLUDING ALL)` copies of production rows in a rolled-back transaction. `INCLUDING ALL` copies the unique indexes, so `ON CONFLICT` works. Columns absent from the JSON become NULL, which violates NOT NULL just as an explicit null would.
