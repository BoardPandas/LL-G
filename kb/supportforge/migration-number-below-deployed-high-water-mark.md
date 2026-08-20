---
tech: supportforge
tags: [migrations, postgres, schema, deployment, worktree, silent-failure]
severity: high
---
# A migration numbered from the repo's highest filename is never applied and never warns

## PROBLEM

`MigrationRunner` applies migrations whose version is **above the high-water
mark recorded in `schema_migrations` on the deployed database**. It does not
apply anything at or below it, and it does not warn when it skips one.

The trap is not "two people picked the same number" -- that is the obvious
version. The trap is that **the highest filename in `database/migrations/` on
your branch is not the high-water mark.** A branch cut before someone else's
migrations landed sees a stale ceiling, and every number you pick from it is
already spent.

Observed 2026-08-20: a feature branch's migration files stopped at `426`. The
deployed database had applied through `435` (CRM work from a branch that landed
in between). A migration written as `427_rmm_session_recordings.sql` would have
been committed, merged, pushed, deployed, and silently never applied -- and the
first symptom would have been `relation "rmm_session_recordings" does not exist`
at runtime, on production, in a code path nobody exercises until a customer
does.

Nothing catches it. The file is syntactically valid, `git` is happy, the test
suite does not touch the database, and the boot log records no error because
skipping is the runner's normal behaviour.

## WRONG

```bash
# Pick the next number by looking at the branch you are standing on.
ls database/migrations | sort -V | tail -2
#   426_staff_workspace_access.sql
#   426_staff_workspace_access_rollback.sql

# "426 is the latest, so mine is 427."
vim database/migrations/427_my_feature.sql
```

## RIGHT

```bash
# Ask the deployed database. It is the only number that decides anything.
DB=$(doppler secrets get DATABASE_URL_PUBLIC --project supportforge --config nf --plain)
psql "$DB" -tAc "SELECT max(version) FROM schema_migrations;"
#   435      <-- nine ahead of what the branch's files show

vim database/migrations/436_my_feature.sql

# Then dry-run it there, inside a transaction you roll back. There is no
# Postgres on the dev box, so this is also the only way to validate the DDL
# against the real schema. Strip the migration's own COMMIT first.
sed 's/^COMMIT;$/ROLLBACK;/' database/migrations/436_my_feature.sql > /tmp/dryrun.sql
psql "$DB" -v ON_ERROR_STOP=1 -f /tmp/dryrun.sql
```

Read the last two lines of the dry run. The migration's own
`INSERT INTO schema_migrations ... ON CONFLICT (version) DO NOTHING` is the
collision detector:

```
INSERT 0 1      <-- the number is free
ROLLBACK

INSERT 0 0      <-- ALREADY TAKEN. This migration would never run.
ROLLBACK
```

## NOTES

- `INSERT 0 0` is the whole check. It costs one line of output and catches the
  case no amount of reading the repo can.
- Concurrent Claude Code sessions and git worktrees make this common rather
  than exotic: several branches are open at once, each with its own view of
  `database/migrations/`, and each one's view is stale the moment another lands.
- Related and different: `migration-dryrun-copy-applied-on-boot.md` is the
  mirror failure -- a dry-run *copy* left in `database/migrations/` gets applied
  for real. Write dry-run copies to `/tmp`, never beside the original.
- Also related: Cloudflare's `unapplied-migration-silent-failure.md` covers a
  migration that was never run at all. This one covers a migration that was run
  past, which produces the same runtime symptom from a different cause -- so
  "check whether it was applied" is not enough; check *why* it was not.
- Renumbering after the fact is cheap (`git mv` plus three `sed` substitutions
  for the filename, the `VALUES (n,` and the rollback's `version = n`). Getting
  it wrong is not.
