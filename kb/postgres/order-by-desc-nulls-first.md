---
tech: postgres
tags: [order-by, nulls-first, nulls-last, null-semantics, three-valued-logic, tie-break, sort, limit]
severity: high
---
# ORDER BY ... DESC defaults to NULLS FIRST, inverting a boolean preference clause

## PROBLEM
A common way to say "prefer the row matching X, fall back to Y" is a boolean sort
key with `LIMIT 1`:

```sql
WHERE (id = $1 OR alt_key = $1)
ORDER BY (alt_key = $1) DESC
LIMIT 1
```

This is correct only while `alt_key` is NOT NULL. When `alt_key` is nullable, the
rows that do NOT match evaluate `NULL = $1` to **NULL**, not `false` -- three-valued
logic. And Postgres defaults `DESC` to **NULLS FIRST** (`ASC` defaults to NULLS
LAST). So the NULL rows -- the non-matches -- sort ABOVE the genuine match, and
`LIMIT 1` returns the wrong row.

The preference clause ends up expressing the exact opposite of its stated intent.
There is no error and no warning: the query returns one plausible-looking row.

It also hides from tests. Fixtures usually populate the nullable column, so the
expression is a real boolean and the ordering looks right; only production data
with legacy NULL rows triggers it. String-matching a unit test against the SQL
(`expect(sql).toContain('ORDER BY (alt_key = $2) DESC')`) passes on the broken
version too, since the bug is in the omitted NULLS clause.

## WRONG
```sql
-- alt_key is nullable: legacy imported rows have alt_key IS NULL.
-- For those rows (alt_key = 234) is NULL, and DESC = NULLS FIRST,
-- so they outrank the row whose alt_key really IS 234.
SELECT id, alt_key FROM t
 WHERE tenant = $1 AND (id = $2 OR alt_key = $2) AND deleted_at IS NULL
 ORDER BY (alt_key = $2) DESC
 LIMIT 1;
-- ref 234 -> returns id=234 (alt_key NULL), NOT the row with alt_key=234
```

## RIGHT
```sql
SELECT id, alt_key FROM t
 WHERE tenant = $1 AND (id = $2 OR alt_key = $2) AND deleted_at IS NULL
 ORDER BY (alt_key = $2) DESC NULLS LAST
 LIMIT 1;
-- ref 234 -> returns the row with alt_key=234, id fallback still works

-- Equivalent null-safe forms, if you prefer the expression to never be NULL:
--   ORDER BY (alt_key = $2) IS TRUE DESC
--   ORDER BY COALESCE(alt_key = $2, false) DESC
--   ORDER BY (alt_key IS NOT DISTINCT FROM $2) DESC
```

## NOTES
Reproduce the semantics in one query, no tables needed:

```sql
WITH t(id, k) AS (VALUES (234, NULL::bigint), (227586, 234::bigint))
SELECT * FROM t ORDER BY (k = 234) DESC LIMIT 1;            -- 234    (wrong)
SELECT * FROM t ORDER BY (k = 234) DESC NULLS LAST LIMIT 1; -- 227586 (right)
```

Detection: grep for `DESC` immediately followed by `LIMIT` on a boolean
comparison against a nullable column -- `ORDER BY (<nullable> = $n) DESC LIMIT`.
The missing `NULLS LAST` is the whole bug.

Write-path corollary, which is worse: the same "match id OR alt_key" predicate
inlined into an `UPDATE`/`DELETE` has no ORDER BY or LIMIT to get wrong, so it
simply affects EVERY matching row. A colliding ref updates/deletes both the
intended row and the unrelated one, while `RETURNING` reports only one of them.
Resolve to a single primary key first, then mutate by that key -- never match on
an ambiguous id-or-alternate-key pair in a mutating statement.

This bites any dual-numbering scheme: a legacy import occupying low internal ids
alongside newer rows carrying a small user-facing number in a nullable column.
The two ranges overlap, so the collision window covers the entire active range
rather than being a rare edge case.

Related: [CREATE TABLE IF NOT EXISTS never retrofits constraints onto existing
tables](create-table-if-not-exists-stale-constraints.md) -- same theme of a
statement that is silently a no-op against pre-existing production data.
