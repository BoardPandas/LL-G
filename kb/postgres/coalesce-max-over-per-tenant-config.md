---
tech: postgres
tags: [aggregates, coalesce, multi-tenant, defaults, retention, null-handling]
severity: high
---
# COALESCE(MAX(col), default) reaches the default only when the table is entirely empty

## PROBLEM

`COALESCE(MAX(col), $default) FROM config_table` reads like "the maximum, and the
platform default for anyone who has not configured one". It is not. `MAX()` over
a table with rows returns the maximum *of those rows*; the `COALESCE` only fires
when the aggregate returns NULL, which happens when **no row matched at all**.

So a per-tenant override table that starts empty behaves perfectly -- every
tenant gets the default -- right up until the first tenant writes a row. From
that moment, that one tenant's value silently speaks for every tenant who
configured nothing. The failure arrives on a config write, not a deploy, which is
why it survives testing and lands weeks later with no correlated change.

The direction of the damage depends on what the value gates, and it is worst when
the configured value is *lower* than the default:

- retention horizons -- one tenant choosing the shortest permitted window makes
  everyone's data expire on that window
- rate limits, quotas, timeouts -- one tenant's tighter setting applies globally
- feature thresholds -- one opt-out reads as a platform-wide opt-out

Verified against production: with one tenant at `raw_days = 7` and two tenants
holding no row at all (entitled to the 30-day default), the query returned **7**.
Those two tenants' data was three weeks from being destroyed early. The corrected
query returns 30. It had never caused harm only because a second, unrelated
condition happened to gate the destructive step -- remove that condition, as we
did, and it becomes silent data loss on the next pass.

## WRONG

```sql
-- "the longest retention anyone is entitled to"
SELECT COALESCE(MAX(retention_days), 30)::int AS days
  FROM tenant_retention;
-- 0 rows      -> 30  (correct, and the state every test runs in)
-- one row, 7  -> 7   (WRONG: answers 7 for tenants entitled to 30)
```

The same shape, equally wrong, with MIN / a filtered aggregate / FILTER:

```sql
SELECT COALESCE(MIN(timeout_ms), 5000) FROM tenant_limits;
SELECT COALESCE(MAX(days), 30) FROM tenant_retention WHERE tenant_id = ANY($1);
```

## RIGHT

Enumerate the population and apply the default **inside** the aggregate, so every
member contributes a value:

```sql
SELECT COALESCE(MAX(COALESCE(r.retention_days, $1)), $1)::int AS days
  FROM tenants t
  LEFT JOIN tenant_retention r ON r.tenant_id = t.id;
```

Two COALESCEs, and both are needed. The inner one gives each unconfigured tenant
the default; the outer one covers a database with no tenants at all.

A `LEFT JOIN` from the authoritative population table is what makes this correct,
so make sure it *is* authoritative -- an FK (`tenant_retention.tenant_id
REFERENCES tenants(id) ON DELETE CASCADE`) is what guarantees the override table
holds no tenant the join will miss.

## NOTES

Test with a **mixed** population. The two states that pass trivially are "no rows
in the override table" and "every tenant has a row"; the bug lives strictly
between them. A test with one configured tenant and at least one unconfigured one
is the whole regression, and it is cheap:

```sql
BEGIN;
INSERT INTO tenant_retention (tenant_id, retention_days) VALUES ('a', 7);
-- old query: 7   new query: 30
ROLLBACK;
```

That runs read-only against production inside a rolled-back transaction, which is
how we confirmed the live value before changing anything.

Beware the floor collision that hides the regression afterwards: if the platform
default is also the CHECK floor (`retention_days BETWEEN 7 AND 400` with a default
of 7), no tenant can configure *below* the default any more, so that column can no
longer exercise the bug at all. Pick a column that still has headroom for the
test, or the regression silently stops being covered.

Related: shared-partition-maximum-retention.md, which is where this one bit.
