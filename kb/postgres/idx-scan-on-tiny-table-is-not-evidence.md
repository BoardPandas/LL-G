---
tech: postgres
tags: [indexes, pg_stat_user_indexes, idx_scan, hot-updates, small-tables, explain]
severity: high
---
# idx_scan on a tiny table does not prove an index is needed

## PROBLEM
A 566-row table updated ~9 times a second had four indexes containing `ts`, the column every update sets. That made 99.5% of 39.7M updates non-HOT, so each one wrote all 11 indexes. `pg_stat_user_indexes` showed those four indexes with huge `idx_scan` counts (one had 201M), which reads as "in use, do not drop". On a table that small the planner picks whatever index exists, so the count only proves the index was available, not that any query needs it.

## WRONG
```sql
-- "201M scans, keep it"
SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE relname = 'agent_heartbeats';
```

## RIGHT
```sql
BEGIN;
CREATE TEMP TABLE agent_heartbeats ON COMMIT DROP AS SELECT * FROM public.agent_heartbeats;
-- recreate only the proposed index set (without the ts indexes)
CREATE UNIQUE INDEX ON agent_heartbeats (client_id, agent_id);
CREATE INDEX ON agent_heartbeats (agent_id);
ANALYZE agent_heartbeats;
SET LOCAL enable_seqscan = off;
EXPLAIN SELECT ... ;  -- every hot query from pg_stat_statements, with real parameter values
ROLLBACK;
```

## NOTES
The temp table shadows the real name through `pg_temp`, so the production query text runs unchanged. Every hot query still had a selective index (unique fingerprint, unique live device, unique (client_id, agent_id), client_id). Only `agent_id` lookups needed a new plain index. After `DROP INDEX CONCURRENTLY` on the four, HOT updates went from 0.5% to 99.4%. A column that changes on every update should not appear in any index on a hot table.
