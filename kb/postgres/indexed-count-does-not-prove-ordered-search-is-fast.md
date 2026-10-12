---
tech: postgres
tags: [query-planner, order-by, limit, pagination, pg-trgm, materialized-cte, performance]
severity: high
---
# An indexed count does not prove ordered pagination uses the search index

## PROBLEM

A search endpoint often runs two queries with the same filters: a total count and a newest-first page. Adding a selective search index can fix the count while leaving the page query unusable. The page's ORDER BY and LIMIT give PostgreSQL another option: scan a chronological B-tree and filter rows until enough matches are found. If matches are rare or absent, that plan may scan most of the history.

This is hard to diagnose when only the count is measured, tiny fixtures fit on one page, or an index's existence is treated as proof it is used. In SupportForge inventory history, the count used the new search indexes while the ordered row query hit a 30-second statement timeout. The missing-term case exposed it.

## WRONG

```sql
-- Example: event_log has a unique primary key id, UUID tenant/customer IDs,
-- a trigram index on label, and a chronological index.
-- Measuring this query alone does not validate the endpoint.
SELECT count(*)
FROM event_log e
WHERE e.tenant_id = $1
  AND ($2::uuid IS NULL OR e.customer_id = $2)
  AND e.label ILIKE $3;

-- Same membership predicate, potentially a very different execution plan.
SELECT e.*
FROM event_log e
WHERE e.tenant_id = $1
  AND ($2::uuid IS NULL OR e.customer_id = $2)
  AND e.label ILIKE $3
ORDER BY e.observed_at DESC, e.id
LIMIT $4 OFFSET $5;
```

Raising the timeout or checking only that the search index is valid does not address the observed planner choice. Sorting or filtering a page after LIMIT also changes which rows belong on the page.

## RIGHT

Measure both complete queries with representative parameters. When the measured failure is the ordered scan, separate matching from pagination using a narrow materialized result, then retrieve full rows only for the selected page:

```sql
-- Count retains exactly the same authorization and search predicates.
SELECT count(*)
FROM event_log e
WHERE e.tenant_id = $1
  AND ($2::uuid IS NULL OR e.customer_id = $2)
  AND e.label ILIKE $3;

WITH matching_events AS MATERIALIZED (
  SELECT e.id, e.observed_at
  FROM event_log e
  WHERE e.tenant_id = $1
    AND ($2::uuid IS NULL OR e.customer_id = $2)
    AND e.label ILIKE $3
), matching_page AS (
  SELECT id, observed_at
  FROM matching_events
  ORDER BY observed_at DESC, id
  LIMIT $4 OFFSET $5
)
SELECT e.*
FROM matching_page p
JOIN event_log e ON e.id = p.id AND e.tenant_id = $1
ORDER BY p.observed_at DESC, p.id;
```

Put every membership predicate, including current ownership joins, tenant/customer scope, source restrictions, and search alternatives, inside the matching query and the count. Generate these from one shared fragment when practical. Use a unique tie-breaker in both page and final output ordering.

## NOTES

- Inspect EXPLAIN (ANALYZE, BUFFERS) for both queries, including the actual prepared-query path when relevant. ANALYZE executes the statement: use a bounded read-only diagnostic transaction for SELECT checks. Compare estimated/actual rows, rows removed by filters, chosen indexes, buffers, and elapsed time.
- Test missing, rare, and broad terms; first and later pages; tenant/customer isolation; identical total membership; and disjoint pages on an unchanged fixture. A unique tie-breaker makes static ordering deterministic, but OFFSET pagination across separate requests is still affected by concurrent inserts or deletes.
- MATERIALIZED prevents folding the matching CTE into its parent; it does not force a particular index or eliminate the cost of matching and sorting. It can increase memory, temporary-file I/O, and latency for broad searches. Keep only needed keys in the intermediate result and measure both selective and broad terms before adopting this shape. Retain a direct chronological path for unfiltered history when that path is already efficient.
- SupportForge's corrected missing-term measurement was approximately 115 ms for the count and 85 ms for rows, after the prior row query reached its 30-second timeout. A broader term still took about 8.6 seconds for its first measured count. These were individual database executions with differing cache conditions, not universal latency guarantees.
- Small correctness fixtures cannot prove production-scale planner performance. Keep real PostgreSQL scope/pagination regressions and separately verify plans against representative data after deployment.
- References: PostgreSQL [Indexes and ORDER BY](https://www.postgresql.org/docs/current/indexes-ordering.html) and [CTE materialization](https://www.postgresql.org/docs/current/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION).
- Related: [A search predicate that matches a row does not make it findable](search-match-without-rank-is-unfindable.md) covers ranking correctness, a separate failure from this query-plan timeout.

