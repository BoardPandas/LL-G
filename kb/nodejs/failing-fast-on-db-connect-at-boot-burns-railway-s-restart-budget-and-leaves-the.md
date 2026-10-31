---
tech: nodejs
tags: [railway, postgres, boot, restart-policy, pg, unhandled-rejection]
severity: high
---
# Failing fast on DB connect at boot burns Railway's restart budget and leaves the API down after the DB recovers

## PROBLEM
A Node service that exits when its first DB query fails at boot can stay CRASHED for hours after the database comes back.
Railway's ON_FAILURE policy allows 10 restarts. With pg `connectionTimeoutMillis: 5000`, each boot dies in about 5 s, so a database outage spends the whole budget in about 70 s, and nothing restarts the service afterwards. The trigger is often a timer job awaiting a DB write outside its try, which becomes an unhandledRejection and shuts the process down.

## WRONG
```ts
await new MigrationRunner(db).runPendingMigrations(); // throws -> exit -> restart loop
setTimeout(() => { maintenance(); }, ms);             // rejection unhandled
```

## RIGHT
```ts
await waitForDatabase(db); // SELECT 1 with capped backoff; retry only connection errors
await new MigrationRunner(db).runPendingMigrations();
setTimeout(() => { void maintenance().catch(err => console.error('[job] failed:', err)); }, ms);
// Retryable errors:
//   ECONNREFUSED, ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN
//   SQLSTATE 57P01, 57P02, 57P03, 53300
//   "Connection terminated due to connection timeout", "timeout exceeded when trying to connect"
// Fail fast on 28P01 (auth), 3D000 (missing database), etc.
```

## NOTES
- Extends nodejs/scheduled-job-bookkeeping-unhandled-rejection.
- `start*` schedulers that await their first run before arming `setInterval` never arm if that run times out during a post-restart warm-up. Arm the interval before or regardless of the first run.
- A new deploy that waits forever still fails its healthcheck, so the old deploy keeps serving.
