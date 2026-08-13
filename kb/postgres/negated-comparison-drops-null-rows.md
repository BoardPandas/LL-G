---
tech: postgres
tags: [null, three-valued-logic, is-distinct-from, not-exists, negation, where-clause, membership]
severity: high
---
# A negated comparison drops NULL rows into neither the set nor its complement

## PROBLEM

`col <> 'x'` is not the opposite of `col = 'x'`. When `col` is NULL both evaluate to NULL, which `WHERE` treats as not-true, so the row is excluded from **both** queries. The same holds for `NOT LIKE`, `NOT IN`, and any `NOT (...)` wrapped around a comparison that can see a NULL.

Nothing errors. Each query on its own returns a plausible, non-empty result, and the predicate reads exactly like the sentence it was written from. The bug only appears when the two sides are added up — a filter and its inverse do not reconstitute the table — and nothing in the schema, the plan, or the logs points at it.

This is worst where a predicate defines a *set* rather than a page of results: group membership, targeting rules, audience segments, saved views, cohort definitions. A row that is in neither the group nor its complement is invisible to whoever wrote both. Discovered building a fleet-targeting rule engine, where "hostname is not kiosk" excluded every device that had never reported a hostname — precisely the broken machines the rule existed to catch.

An added trap: a negated join looks like it expresses "does not have any of these tags", but `LEFT JOIN ... WHERE link.id IS NULL` and `JOIN ... WHERE tag_id <> ANY(...)` both mishandle the row that has *no* link rows at all, which is usually the largest part of the answer.

## WRONG

```sql
-- Scalar negation: a device with hostname IS NULL is in neither result.
SELECT * FROM devices WHERE hostname = 'kiosk';       -- 38 rows
SELECT * FROM devices WHERE hostname <> 'kiosk';      -- 1394 rows
-- 38 + 1394 = 1432, but the table has 1489. 57 rows vanished.

-- Same trap, three more spellings:
WHERE platform NOT IN ('windows', 'darwin')           -- NULL platform excluded
WHERE hostname NOT ILIKE '%lab%'                      -- NULL hostname excluded
WHERE NOT (last_seen >= NOW() - INTERVAL '30 days')   -- never-seen excluded

-- Link tables: a device carrying no tags at all matches neither of these.
SELECT * FROM devices d
  JOIN device_tags t ON t.device_id = d.id
 WHERE t.tag_id <> ALL($1::uuid[]);
```

## RIGHT

```sql
-- IS DISTINCT FROM is NULL-aware equality: it always returns true or false.
SELECT * FROM devices WHERE hostname IS DISTINCT FROM 'kiosk';   -- 1451 rows
-- 38 + 1451 = 1489. The set and its complement now partition the table.

-- Negated pattern match: say what NULL should do, out loud.
WHERE (hostname IS NULL OR hostname NOT ILIKE '%lab%')

-- Negated list membership.
WHERE (platform IS NULL OR NOT (platform = ANY($1::text[])))

-- A NULL timestamp satisfies "not seen recently" -- never seen is not seen.
WHERE (last_seen IS NULL OR last_seen < NOW() - make_interval(days => $1))

-- Link tables: NOT EXISTS, never a negated join. A row with no link rows
-- satisfies it, which is what "has none of these tags" means.
SELECT * FROM devices d
 WHERE NOT EXISTS (
   SELECT 1 FROM device_tags t
    WHERE t.device_id = d.id AND t.tag_id = ANY($1::uuid[])
 );
```

## NOTES

**Test it as a partition, not as a query.** The assertion that catches this is `count(P) + count(NOT P) = count(*)`, run against real data. Neither side alone looks wrong, and a unit test with a stubbed database cannot see it at all — the arithmetic is the test.

**`IS DISTINCT FROM` is not free.** It is not indexable the way `=` is, so on a large hot table check the plan. Where the column is genuinely `NOT NULL`, plain `<>` is correct and faster — but confirm the constraint exists rather than assuming it from the data, since a column that happens to be fully populated today is not the same as one that cannot be null tomorrow.

**Wrapping the whole predicate does not help.** `NOT (col = 'x')` has the identical problem: NULL negated is still NULL. The NULL has to be named explicitly somewhere.

**`COUNT(col)` vs `COUNT(*)`** is the cheapest way to find out how much NULL a column actually carries before writing any predicate over it — the same profiling step that [filter-on-empty-column-matches-nothing.md](filter-on-empty-column-matches-nothing.md) recommends, and worth doing for the same reason.

Related: [order-by-desc-nulls-first.md](order-by-desc-nulls-first.md) is the ordering-side version of this — a NULL comparison result that lands the wrong way round because `DESC` sorts NULLS FIRST.
