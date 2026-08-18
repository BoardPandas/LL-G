---
tech: postgres
tags: [migrations, ddl, remediation, data-loss, schema-drift, tombstone]
severity: high
---
# A stranded migration is not a pending migration, and applying it late can destroy live data

## PROBLEM

Two existing entries cover how a migration gets stranded --
[forward-only-runner-skips-duplicate-version](forward-only-runner-skips-duplicate-version.md)
and [ledger-high-water-mark-strands-migrations](ledger-high-water-mark-strands-migrations.md).
Both stop at the same place: renumbering is impossible once a colliding file has
applied, and you need a manual ledger edit. This is about what you do next, and
the intuitive answer is wrong.

The instinct on finding a stranded migration is to give it the next free version
so it finally runs. That treats it as *pending* -- delayed, but still wanted.
It is not. Its DDL was written against the schema as it stood on the day it was
authored, and it has been out of the loop ever since. Every migration that ran
in the interval widened the gap. A file that was correct in August 2025 can be
actively destructive by the following August, and nothing about it looks
different.

The damage is worst for the migrations most likely to be stranded. Cleanup
migrations -- the ones full of `DROP TABLE ... CASCADE` -- are exactly the kind
of low-stakes housekeeping change that gets authored concurrently with something
else and loses the version race. They are also the only kind whose late
application deletes data.

Seen live: `100_schema_optimization.sql` lost a collision in Aug 2025 and never
applied. It drops nine tables, one of which is `audit_log`. Eight of the nine
did go away on their own over the following year. `audit_log` did not -- it was
re-adopted, and now holds ~3,944 rows with 15 references in application code.
Renumbering the file to "catch up the ledger" would have run a year-old
`DROP TABLE audit_log CASCADE` against live audit history, to satisfy an intent
that expired long ago.

Two things make this hard to see:

**The detection signature reads as partial application.** Only the objects
*unique* to the stranded file are missing. Anything it declares that a later
migration also declares is present, because the later one ran. In our case the
stranded file's `agent_heartbeats` columns existed in production -- created by
migration 326 -- while its `org_agent_status` columns did not. That looks like
the file half-ran. It never ran at all.

**The effects leak into the schema dump.** A dump taken from a machine where the
migration *did* apply carries objects production lacks, and can be internally
inconsistent. Ours declares
`CREATE INDEX idx_org_agent_status_rollout ... (rollout_percentage)` while its
own `CREATE TABLE public.org_agent_status` defines no such column -- so the
fresh-install seed would fail on a statement production never needed, and
dev/prod diverge in opposite directions from the same root cause.

## WRONG

```bash
# Found a stranded migration. Give it a version the runner can reach.
git mv database/migrations/100_schema_optimization.sql \
       database/migrations/424_schema_optimization.sql
git commit -m "Renumber stranded migration so it finally applies"
# Deploy runs it. A year-old DROP TABLE audit_log CASCADE executes
# against 3,944 rows of live audit history. Nothing warns; the DDL is valid,
# the runner is behaving correctly, and the table it names still exists.
```

## RIGHT

```bash
# 1. Establish it really never ran: only objects UNIQUE to the file are absent.
#    Shared objects being present is not partial application.
psql "$DB" -Atc "SELECT column_name FROM information_schema.columns
                 WHERE table_name='org_agent_status'
                   AND column_name LIKE '%rollout%';"     # -> empty

# 2. Read every statement in the file against reality NOW, not against intent.
grep -inE '^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE)' migrations/100_*.sql

# 3. For each destructive statement, ask whether the target is still dead.
psql "$DB" -Atc "SELECT count(*) FROM audit_log;"          # -> 3944  ** live **
grep -rn 'audit_log' src/ --include=*.ts | grep -vc __tests__   # -> 15  ** live **

# 4. It is void. Tombstone it: keep the filename so the version stays claimed
#    and the record sits where the next person looks. No DDL left in the file.
cat > database/migrations/100_schema_optimization.sql <<'SQL'
-- VOID. Never applied; must never be applied.
-- Lost a version collision (see git show <sha> for the original statements).
-- Its DROP TABLE audit_log CASCADE would now delete ~3,944 live rows
-- referenced from 15 places. A stranded migration describes a database
-- that no longer exists.
SQL
```

## NOTES

- **Voiding is a legitimate outcome, and usually the right one.** Ask what the
  file would buy applied today, not what it was for. Our harmless stranded
  migration added four columns with zero non-test references anywhere in the
  codebase; adding them a year late to tidy a ledger buys nothing and is not
  worth the deploy.
- **Keep the filename, empty the contents.** Deleting the file frees the version
  number for reuse and leaves the next person to rediscover all of this from git
  archaeology. A comment-only file is valid SQL, runs as a no-op if anything
  ever does reach it, and puts the explanation where someone would look.
- **Check the schema dump separately.** `database/schema.sql` (or equivalent
  fresh-install seed) may carry the stranded migration's objects if it was
  generated on a machine where the file applied. That is a distinct defect from
  the stranded migration and survives tombstoning it.
- The mechanism entries are
  [forward-only-runner-skips-duplicate-version](forward-only-runner-skips-duplicate-version.md)
  and [ledger-high-water-mark-strands-migrations](ledger-high-water-mark-strands-migrations.md);
  read those for how to stop stranding migrations in the first place. Selecting
  by ledger membership rather than `version > MAX(version)` prevents new
  stranding but does not make an old stranded file safe to apply -- it would
  simply run it, which is the failure above.
