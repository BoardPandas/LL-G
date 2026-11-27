---
tech: postgres
tags: [postgres, pg_dump, backup, migrations, lock_timeout, access-exclusive, deploy, railway]
severity: high
---
# A nightly pg_dump makes boot-time migrations fail with lock_timeout on every restart

## PROBLEM
`pg_dump` holds `AccessShareLock` on every table it dumps for the whole length of the
dump. DDL that needs `ACCESS EXCLUSIVE` (`ALTER TABLE ... ADD COLUMN`, `ADD CONSTRAINT`,
`CREATE TRIGGER`) cannot get its lock until the dump finishes.

When migrations run on API boot with a short `lock_timeout` (5 s here), a deploy that
lands during the backup window fails the same way on every restart:
`canceling statement due to lock timeout`. The platform marks the deploy failed and keeps
the old API serving. Frontend services without migrations deploy normally, so the new UI
talks to the old API until someone notices (about 20 minutes in the observed case).

It looks like a bad migration. It is not one: by the time you investigate, the dump has
finished, `pg_locks` shows nothing, and the same migration applies in 0.1 s.

## WRONG
```bash
# Push a commit carrying lock-taking DDL during the nightly backup window,
# then "fix" the repeated lock timeouts by removing or raising lock_timeout.
git push origin main          # lands at 08:02 UTC, dump runs ~08:00
# migration: SET LOCAL lock_timeout = '5s'; ALTER TABLE notes ADD COLUMN parent_id ...
```

## RIGHT
```bash
# 1. Read-only check that nothing still holds locks / no long transaction is open
psql -c "SELECT pid, state, xact_start, left(query,80) FROM pg_stat_activity WHERE xact_start < now() - interval '1 minute';"
psql -c "SELECT relation::regclass, mode, granted FROM pg_locks WHERE NOT granted;"
# 2. Redeploy the failed API deployment (the migration now applies)
# 3. Re-run the failed "production serves this commit" CI check
```
Keep the `lock_timeout`: it is what stopped the ALTER from queueing behind the dump and
blocking every reader of the table behind it. Schedule pushes that carry lock-taking
migrations outside the backup window, or move the backup away from deploy hours.

## NOTES
Each failed attempt rolled back cleanly because the migration ran in a transaction; the
schema version did not move. Find the backup schedule before blaming the migration.
