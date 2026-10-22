---
tech: postgres
tags: [cte, materialization, nested-loop, query-planner, window-functions, statement-timeout, analytics]
severity: high
---
# A CTE joined back onto another CTE can nested-loop for minutes

## PROBLEM
A CTE referenced more than once is materialized, and the planner cannot see statistics
inside it. Join a grouped or filtered CTE back onto another CTE and the estimate can
collapse to a handful of rows, so Postgres picks a nested loop. A stats query joining a
per-game CTE (about 12k real rows) to a 240k-row seat CTE ran 5 minutes on a shared prod
pool. A differently shaped draft of the same figure ran in about 400 ms in psql, so the bad
plan appeared only with the shipped statement, and a fake pool in unit tests shows nothing.
Killing the ssh session of a dry run did not stop the node process or its query.

## WRONG
```sql
WITH p AS (SELECT pp.* FROM pod_participants pp JOIN m ON m.id = pp.match_id),
     g AS (SELECT match_id, game_no, bool_or(won) AS decided FROM p GROUP BY 1, 2),
     f AS (SELECT DISTINCT ON (match_id, game_no) match_id, game_no, seat, eliminated_turn
             FROM p WHERE eliminated_turn IS NOT NULL ORDER BY match_id, game_no, eliminated_turn)
SELECT ... FROM f JOIN p USING (match_id, game_no) JOIN g USING (match_id, game_no)
 WHERE g.decided;
```

## RIGHT
```sql
-- Game-level facts as WINDOW columns; each statement reads the CTE once and joins nothing to it.
WITH p AS (
  SELECT pp.*, bool_or(pp.won) OVER w4 AS decided
    FROM pod_participants pp JOIN m ON m.id = pp.match_id
  WINDOW w4 AS (PARTITION BY pp.match_id, pp.game_no)
), x AS (
  SELECT seat, won, decided,
         first_value(eliminated_turn) OVER w AS first_ko_turn
    FROM p WINDOW w AS (PARTITION BY match_id, game_no ORDER BY eliminated_turn NULLS LAST, seat)
)
SELECT ... FROM x WHERE decided;
```
```ts
// Bound the worst case on a shared pool.
await client.query("BEGIN READ ONLY");
await client.query("SET LOCAL statement_timeout = 30000");
```

## NOTES
- Use `lead()` / `first_value()` / `bool_or() OVER` instead of grouping and joining back.
- A self-join that cannot be avoided goes between the real tables (stats, PK), not between CTEs.
- Time every exact shipped statement in psql before release; a test can assert each statement
  reads the CTE at most once (count `FROM p` / `JOIN p`).
- After killing a hung dry run, check `pg_stat_activity` and `pg_cancel_backend` the query.
- Source: BoardPandas/tcg 3.830.0.0, `dashboard/src/lib/pod-ladder-stats-store.ts`.
