---
tech: postgres
tags: [primary-key, upsert, on-conflict, null, deduplication, idempotency, ingest, composite-key]
severity: high
---
# A nullable column in a composite primary key silently disables ON CONFLICT deduplication

## PROBLEM

The standard idempotent-ingest pattern is a composite primary key over the natural identity of a measurement, plus `ON CONFLICT ... DO NOTHING`, so a client that cannot tell whether its POST landed can retry unconditionally and a replay collides instead of double-counting.

That pattern quietly stops working the moment any column in the key is nullable, because **NULL is never equal to NULL**. Two rows whose key differs only by a NULL in that column do not conflict, so `ON CONFLICT` never fires and every retry inserts a fresh row.

The reason it survives review is that Postgres permits it and it *looks* enforced: `PRIMARY KEY` implies `NOT NULL` on every column, so the failure cannot happen there. But the same key expressed as a `UNIQUE` constraint or a unique index -- which is what you reach for when you want a partial index, or when the table is partitioned and the key must include the partition column, or when you add a column to an existing key with `CREATE UNIQUE INDEX ... ON (a, b, c)` -- carries no such implication. The column stays nullable, and the constraint silently becomes "unique among rows where c is not null".

It then fails for exactly the rows most likely to exist. In a metrics table keyed `(device, metric, dimension, bucket)`, `dimension` names a mount point or an interface -- and is absent for `cpu.percent`, `memory.percent`, `uptime.seconds`, the most common series in the system. Every retry on those appends. The dimensioned series dedupe correctly, so the table looks healthy, the tests pass, and the fault is a slow drift in row counts and double-counted averages that nobody attributes to the ingest path.

## WRONG

```sql
-- Partitioned, so the key must include bucket_at; expressed as a unique index.
-- `dimension` is nullable, and nothing complains.
CREATE TABLE metric_points (
  device_id  UUID        NOT NULL,
  metric     VARCHAR(64) NOT NULL,
  dimension  VARCHAR(128),                 -- nullable: the whole bug
  bucket_at  TIMESTAMPTZ NOT NULL,
  value      DOUBLE PRECISION NOT NULL
) PARTITION BY RANGE (bucket_at);

CREATE UNIQUE INDEX ON metric_points (device_id, metric, dimension, bucket_at);

-- The retry after a timed-out POST. Intended to be a no-op.
INSERT INTO metric_points (device_id, metric, dimension, bucket_at, value)
VALUES ($1, 'cpu.percent', NULL, $2, $3)
ON CONFLICT (device_id, metric, dimension, bucket_at) DO NOTHING;
-- Inserts every single time. NULL <> NULL, so nothing ever conflicts.
```

## RIGHT

```sql
-- Make the sentinel a real value. NOT NULL DEFAULT '' is enforceable,
-- indexable, and equal to itself.
CREATE TABLE metric_points (
  device_id  UUID        NOT NULL,
  metric     VARCHAR(64) NOT NULL,
  dimension  VARCHAR(128) NOT NULL DEFAULT '',
  bucket_at  TIMESTAMPTZ NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (device_id, metric, dimension, bucket_at)
) PARTITION BY RANGE (bucket_at);

INSERT INTO metric_points (device_id, metric, dimension, bucket_at, value)
VALUES ($1, 'cpu.percent', '', $2, $3)
ON CONFLICT (device_id, metric, dimension, bucket_at) DO NOTHING;
-- The replay collides and is discarded. rowCount 0 means "already stored".
```

Carry the sentinel all the way out to the client contract, so a caller cannot reintroduce the NULL:

```ts
// The absent dimension defaults to '', never to null or undefined.
dimension: z.string().max(128).default('')
```

## NOTES

- Test the undimensioned case explicitly. A fixture that only exercises rows with a dimension present passes while the common path is broken -- insert the same undimensioned row twice and assert the second insert reports zero rows affected.
- `NULLS NOT DISTINCT` (Postgres 15+) makes a unique index treat NULLs as equal and is a legitimate fix: `CREATE UNIQUE INDEX ... ON t (a, b, c) NULLS NOT DISTINCT`. Prefer the non-null sentinel anyway -- it is version-independent, it survives the index being rebuilt by a tool that drops the clause, and `''` reads unambiguously in query results where a NULL invites "is that missing or is that the default?".
- Same trap in `DELETE ... WHERE key = ANY($1)` sweeps and in any join on the composite key: the NULL rows silently drop out of both the match and its complement. See [a negated comparison drops NULL rows into neither the set nor its complement](negated-comparison-drops-null-rows.md).
- Audit existing tables with: `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indisunique AND NOT a.attnotnull;` -- every row is a unique constraint that is not enforcing what its name suggests.
- Detect it in the wild by grouping on the key and counting: a duplicate count above 1 on a key that is supposed to be unique is the signature.
