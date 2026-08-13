---
tech: supportforge
tags: [migrations, postgres, deployment, auto-migrate, dry-run, schema, concurrency]
severity: high
---
# A dry-run copy of a migration left in database/migrations/ is applied for real on the next boot

## PROBLEM

There is no Postgres on the dev box, so the way to validate new DDL is to run it against production inside `BEGIN … ROLLBACK`. That means stripping the migration's own `BEGIN`/`COMMIT` (an inner `COMMIT` would defeat the outer rollback) and saving the stripped copy somewhere `psql` can `\i` it. Saving that copy next to the original is the mistake.

`MigrationRunner` (`src/database/migrations.ts`, run from `bootstrap.ts` when `AUTO_MIGRATE` is on) selects by filename: any `^\d+_.*\.sql$` that does not end in `_rollback.sql`. `400_x_dryrun.sql` matches, so it is a second migration as far as the runner is concerned.

The timing is what makes this dangerous rather than merely untidy. Pending work is chosen by **high-water mark** — `version > appliedMax` — not by a per-file ledger check. So:

- A duplicate-numbered file whose version is already applied is silently skipped, which is why this can sit unnoticed.
- A duplicate-numbered file whose version is still **pending** is applied — and that is exactly the state a dry run happens in, because you only dry-run a migration that has not been applied yet.

Both files then land in one boot. `readMigrationFiles()` sorts by version only, and both are version 400, so which runs first is `readdir` order — undefined. The stripped copy runs **untransacted** (that was the point of stripping it), so a statement that fails halfway leaves the schema partly changed with nothing to roll back to, and `applyFile` fails fast and aborts boot.

Nothing warns you at the time. The dry run itself succeeds and rolls back cleanly, so the validation step looks like it worked. The scratch file is untracked, so it never shows up in a staged diff. The damage happens on a deploy hours later.

If the migration is written defensively (`CREATE TABLE IF NOT EXISTS` throughout) the second pass is a silent no-op instead — which is not a reprieve, just a quieter version of the same bug waiting for the first `ALTER TABLE ADD COLUMN` that has no `IF NOT EXISTS`.

## WRONG

```bash
# Strip the transaction markers so the whole thing runs inside one rolled-back tx...
sed -e 's/^BEGIN;$//' -e 's/^COMMIT;$//' \
  database/migrations/400_rmm_durable_jobs.sql \
  > database/migrations/400_rmm_durable_jobs_dryrun.sql   # <-- now a pending migration

psql "$PGURL" -f check.sql        # check.sql: \i database/migrations/400_..._dryrun.sql
# Dry run passes, transaction rolls back, everything looks fine.
# Next deploy, with 400 still pending: BOTH 400 files are applied, in readdir
# order, and the stripped one runs with no BEGIN/COMMIT around it.
```

```bash
# And the number: "last applied is 398, so mine is 399" — while another session
# already has an uncommitted 399_*.sql in the same checkout.
psql "$PGURL" -At -c "SELECT MAX(version) FROM schema_migrations"
```

## RIGHT

```bash
# The stripped copy lives outside the directory the runner reads.
SCRATCH=$(mktemp -d)
sed -e 's/^BEGIN;$//' -e 's/^COMMIT;$//' \
  database/migrations/400_rmm_durable_jobs.sql > "$SCRATCH/400_dryrun.sql"

psql "$PGURL" -v ON_ERROR_STOP=1 -f "$SCRATCH/check.sql"   # \i $SCRATCH/400_dryrun.sql

# database/migrations/ only ever holds real migrations and their rollbacks.
ls database/migrations | tail -5
```

```bash
# Pick the number from the working tree, not from what is applied: uncommitted
# files from a concurrent session are invisible to schema_migrations.
ls database/migrations | grep -oE '^[0-9]+' | sort -n | tail -1
```

```bash
# After the deploy, confirm the runner applied what you expected and nothing else.
psql "$PGURL" -At -c \
  "SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 5"
```

## NOTES

- The dry run is still the right technique — running the migration *and* the statements that depend on it against the production schema inside one rolled-back transaction catches column and syntax errors that mocked query tests cannot. The hazard is only where the stripped copy is written.
- Keep the scratch copy out of the repo entirely, including `.git/`: in a checkout shared by concurrent sessions, another session's git activity can remove untracked files there mid-task.
- Applies to any numbered `.sql` that is not a real migration: a `_v2`, a `.bak` that kept the `.sql` extension, an editor's merge `.orig`. The runner filters on the filename pattern, not on intent.
- `_rollback.sql` is the one suffix the runner skips, and it is the only one. Do not assume `_dryrun`, `_test` or `_tmp` are filtered.
- The high-water mark also means a duplicate number is *not* protection: two different migrations sharing a version both run if that version is pending, and afterwards the ledger records one number for two files. Since applied migrations are never renumbered, a collision found after a deploy has to be resolved by a new migration rather than by renaming.
- Related: `auto-migrate-runs-on-api-boot` — grep case-insensitively for `migrat` before assuming schema changes are applied by hand.
