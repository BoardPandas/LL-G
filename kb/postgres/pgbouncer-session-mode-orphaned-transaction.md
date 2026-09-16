---
tech: postgres
tags: [pgbouncer, connection-pool, idle-in-transaction, locks, timeouts, node-postgres, outage-diagnosis]
severity: high
---
# PGBouncer session mode holds an orphaned transaction's locks until something reaps it

## PROBLEM

PGBouncer in `pool_mode = session` binds a server connection to its client for the
whole session. If the client dies without a disconnect the pooler actually observes
— a container torn down, a network namespace removed, a half-open socket — PGBouncer
keeps that connection **and any locks its open transaction holds**, forever.
`client_idle_timeout` and `idle_transaction_timeout` both default to `0`, so nothing
reaps it.

Measured directly (open `BEGIN; SELECT` through the pooler, observe from an
independent connection):

| client death | outcome |
|---|---|
| one PGBouncer CAN see (SIGKILL the client process) | reaped at **t+0s**, even mid-transaction |
| one it cannot see | **indefinite** |

The damage is not the one stuck connection — it is everything that queues on its
locks. Each waiter holds a pool slot while it waits, so a 5-minute cron is enough:
each run blocks, holds a connection, and the next starts before the last finished.
The application pool is gone in a few hours.

**It never presents as a database problem.** Every feature that needs a connection
fails at once, so it reads as "the whole app is broken". In one production case a
single leaked transaction held locks for **12h14m**, 26 transactions queued behind
it, sign-in was down the entire time — and Postgres itself was healthy throughout at
**46 of 100 connections**. The pool was starved, not the server.

Three things mislead the diagnosis:

1. `Error: timeout exceeded when trying to connect` is **node-postgres' pool**, not
   the server. It means "no free slot within `connectionTimeoutMillis`", not
   "database unreachable". People spend the outage debugging connectivity.
2. **A redeploy does nothing.** The blocker lives in the database, not the app.
3. A health check that opens its **own** connection cannot observe pool exhaustion
   by construction, and will report healthy for the entire outage.

## WRONG

```sql
-- Relying on the defaults. Nothing here reaps an orphan.
-- pgbouncer.ini
--   pool_mode = session
--   client_idle_timeout = 0        -- default
--   idle_transaction_timeout = 0   -- default

-- ...and diagnosing the outage at the wrong layer:
SELECT 1;              -- "database is up, must be the app" -> redeploy -> no change

-- ...then killing the loudest backend, which is a WAITER, not the cause.
-- The queue refills instantly because the head of the chain is untouched.
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY query_start   -- the oldest ACTIVE backend is blocked, not blocking
LIMIT 1;
```

## RIGHT

```sql
-- 1. GUARD: set it on the DATABASE, not per-role. A database-level setting reaches
-- direct connections and pooled ones alike; a role-level one misses whichever role
-- you forget. Verified reaping an orphan at 294s through PGBouncer with 5min.
ALTER DATABASE mydb SET idle_in_transaction_session_timeout = '5min';
-- verify on a NEW connection (existing ones keep the old value):
SHOW idle_in_transaction_session_timeout;

-- 2. DIAGNOSE: pool or server? Well under max_connections => pool, not server.
SHOW max_connections;
SELECT usename, state, count(*) FROM pg_stat_activity
WHERE backend_type = 'client backend' GROUP BY 1, 2 ORDER BY 3 DESC;
-- An app role sitting at EXACTLY its configured pool max is the tell.

-- 3. RELEASE: find the HEAD of the lock chain, never the loudest backend.
-- The root blocker is the row others name in blocked_by while having none itself --
-- and it is usually 'idle in transaction', holding locks while running no query.
SELECT pid, usename, state, now() - xact_start AS xact_age,
       pg_blocking_pids(pid) AS blocked_by,
       left(regexp_replace(query, E'\\s+', ' ', 'g'), 120) AS q
FROM pg_stat_activity
WHERE backend_type = 'client backend'
ORDER BY xact_start ASC NULLS LAST;

SELECT pg_terminate_backend(<root_pid>);  -- ONLY the root; the queue drains itself
```

## NOTES

**Before setting an idle-in-transaction timeout, check whether any transaction does
network I/O between statements.** An HTTP call, an AI request or an email send inside
a `BEGIN`/`COMMIT` leaves the session genuinely idle-in-transaction for that duration,
and the timeout would abort legitimate work. If every transaction body is pure SQL, a
five-minute bound is free.

**`client_idle_timeout` is deliberately the wrong fix.** It only covers an orphan that
is *not* in a transaction — which holds no locks and cannot cause this outage — while
reaping healthy idle pooled connections. Bound the harmful case with
`idle_in_transaction_session_timeout` instead. Add PGBouncer's
`idle_transaction_timeout` as a backstop if you like, set *longer* than the database
guard so the database fires first and the client gets a clean error.

**Give latency-sensitive work its own pool.** Any pool shared with bulk/background
work inherits its exhaustion. Authentication is the usual casualty: sign-in queries
are tiny indexed lookups on tables no bulk job touches, so a small reserved pool keeps
them servable while the main pool is wedged.

**Layered defence, in priority order:** database-level
`idle_in_transaction_session_timeout` (covers every route) -> a separate pool for
auth/critical paths -> drain pools on process shutdown (`pool.end()` before
`process.exit`, bounded by a timeout, since `end()` waits on checked-out clients that
a wedged transaction never releases) -> PGBouncer `idle_transaction_timeout` as a
backstop.

This is a pooler/runtime gotcha, not a schema one: it will not show up in migration
review or tests, only under a teardown that lands inside a transaction.
