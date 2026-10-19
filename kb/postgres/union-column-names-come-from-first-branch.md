---
tech: postgres
tags: [union, union-all, column-alias, cte, refactor, order-by, fake-pool, query-splitting]
severity: high
---
# A UNION takes its column names from its first branch, so reordering branches renames columns

## PROBLEM
`UNION` / `UNION ALL` names its output columns after the FIRST branch only; later
branches' aliases are ignored. A query whose first branch aliases a computed column
(`0 AS match_rank`) and whose later branches leave it bare (`CASE ... END`, `3`) works,
until a refactor splits or reorders the branches so an unaliased one comes first. The
column is then called `case` or `?column?`, and `h.match_rank` downstream fails with
42703 "column does not exist" -- or, if another column happens to carry the name,
sorts or filters on the wrong one with no error. Unit tests that fake the pool and
match on SQL text cannot see it; only running the SQL can.

Seen 2026-10-19 (tcg card lookup): splitting one name-matching query into an indexed
whole-name pass and a face/flavor pass put the unaliased face branch first.

## WRONG
```sql
-- fine while the whole-name branch is first; breaks when it is split off
SELECT w.ord, CASE WHEN f.pos = 1 THEN 1 ELSE 2 END, c.* FROM ...   -- unaliased
UNION ALL
SELECT w.ord, 3, c.* FROM ...                                          -- unaliased
-- ... ORDER BY h.ord, h.match_rank   -> ERROR: column h.match_rank does not exist
```

## RIGHT
```sql
SELECT w.ord, CASE WHEN f.pos = 1 THEN 1 ELSE 2 END AS match_rank, c.* FROM ...
UNION ALL
SELECT w.ord, 3 AS match_rank, c.* FROM ...
```

## NOTES
Name every computed column in every branch, so any branch can be first. When a query
is assembled from branch fragments, run each assembled variant against a real Postgres
(a throwaway `initdb` cluster with the real schema is enough); a fake pool proves only
the SQL you assumed. Sibling: `search-match-without-rank-is-unfindable.md`.
