---
tech: postgres
tags: [migrations, schema_migrations, rollback, deploy, ledger, high-water-mark, auto-migrate]
severity: high
---
# The migration ledger's high-water mark is what decides, and it lies in both directions

## PROBLEM

A forward-only runner selects files whose version is above the applied high-water mark in `schema_migrations`. That mark is a **fact about production**, not about your working tree — and checking `ls migrations/ | tail` before picking a number tests the wrong thing. Two failure modes follow, both silent, both ending in code deployed against tables that do not exist while the runner reports "up to date".

**1. Another session's higher number lands first.** No collision is required. You allocate `405`, spend an hour building against it, and while you work a concurrent session commits `406` and deploys. The mark is now 406, `405 > 406` is false, and your migration is skipped on that deploy and every deploy after it. Your file is unique on disk, dry-runs cleanly against production, and will never execute.

**2. A rollback drops the tables and leaves the ledger row.** This is the sharper one, because it strands *other people's* migrations too. A rollback script that runs `DROP TABLE` but forgets `DELETE FROM schema_migrations WHERE version = N` leaves the ledger claiming N is applied when nothing of N exists. The mark stays at N. Every pending migration numbered **below** N — written by other sessions, entirely correct, never applied — is now unreachable forever, along with N itself.

Observed live: prod's ledger read `409 rmm_software_inventory`, `408 rmm_hardware_inventory`, both stamped with real `applied_at` timestamps, and **not one of their fourteen tables existed**. Two rollbacks had dropped the tables without touching the ledger. A third package's migration `407`, sitting correct and committed, was silently stranded by two other packages' cleanup.

Runners that discard "phantom" ledger rows above the highest file on disk do not save you: the row stops looking phantom the moment that session commits its file.

## WRONG

```bash
# Picking a number by looking at the working tree.
ls database/migrations | tail -3
# 403_rmm_approvals.sql
# 404_something.sql
# -> "405 is free"                      # says nothing about production
```

```sql
-- A rollback that strands every lower-numbered pending migration.
BEGIN;
DROP TABLE IF EXISTS rmm_installed_software;
DROP TABLE IF EXISTS rmm_computer_systems;
-- schema_migrations still says 409 is applied. High-water mark stays 409.
COMMIT;
```

## RIGHT

```bash
# The number must be above PRODUCTION's mark, not merely unique on disk.
psql "$DATABASE_URL" -c \
  "SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 5"
# Re-run this immediately before `git commit` -- a concurrent session can
# deploy in the minutes between choosing a number and committing it.
```

```sql
-- Every rollback ends by retracting its own claim.
BEGIN;
DROP TABLE IF EXISTS rmm_installed_software;
DROP TABLE IF EXISTS rmm_computer_systems;
DELETE FROM schema_migrations WHERE version = 409;   -- not optional
COMMIT;
```

```sql
-- Reconciling a ledger that already lies: prove each claim before trusting it.
SELECT m.version, m.name, m.applied_at
  FROM schema_migrations m
 WHERE m.version > 400
   AND NOT EXISTS (SELECT 1 FROM pg_tables t WHERE t.tablename = 'expected_table_for_'||m.version);
-- Rows returned are claims with nothing behind them. Delete those versions and
-- let the runner apply them -- and everything below them -- on the next boot.
```

## NOTES

- **Select by ledger membership, not by `version > MAX(version)`.** `WHERE version NOT IN (SELECT version FROM schema_migrations)` makes both failure modes impossible, and makes a duplicate version an error instead of a silent skip. Until the runner is fixed, the manual checks above are the whole control.
- **A passing dry run says nothing about whether the file will be reached.** Validating DDL inside `BEGIN … ROLLBACK` proves the SQL is correct; it does not prove the runner will ever run it. Both checks are needed, and they answer different questions.
- **`applied_at` is not evidence.** It records when the row was inserted, which a rollback does not undo. Verify against `pg_tables` / `information_schema`, not against the ledger's own account of itself.
- **The blast radius is other people's work.** A single missing `DELETE` in one rollback strands every lower-numbered pending migration in the repo, and the sessions that wrote them have no way to notice — their files are committed, unique, and correct.
- **Symptom on the far side:** relation-does-not-exist errors at runtime while `schema_migrations` reports up to date and the deploy log says nothing. See also `forward-only-runner-skips-duplicate-version.md` (the same mark, broken by a duplicate number) and `unapplied-migration-silent-failure.md` in `kb/cloudflare/`.
