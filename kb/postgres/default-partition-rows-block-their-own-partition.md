---
tech: postgres
tags: [partitioning, default-partition, declarative-partitioning, detach-partition, attach-partition, scheduled-jobs, monitoring, ddl, telemetry, time-series]
severity: high
---
# Rows in a DEFAULT partition make their own range partition uncreatable, so one missed day never heals

## PROBLEM

A DEFAULT partition is presented as the safety net for range-partitioned tables:
without one, an INSERT whose key falls outside every partition raises
`no partition of relation ... found for row` and takes the whole batch with it.
So you add one, park the strays, and move on.

The net is a trap. Postgres will not carve a range out of the parent while the
default partition holds any row that would belong to that range:

```
ERROR:  updated partition constraint for default partition
        "metric_points_default" would be violated by some row
```

That single fact makes a partition-maintenance job **self-perpetuating on first
failure**, and this is the part that is not obvious. The usual mental model is
"the job failed once, it will catch up next run." It cannot. The sequence is:

1. The job fails for any reason at all on day D — a privilege error, a lock
   timeout, a deploy that never started it. The runway is not extended.
2. Midnight passes. Day D's rows have nowhere to go, so they land in the default.
3. Every subsequent run now fails on day D with the constraint error above, *for
   a completely different reason than the original failure*, and the original
   cause may already have been fixed.
4. Midnight passes again. Day D+1 joins them. The hole widens by one day, every
   day, forever.

Nothing in the running system can clear it, because the drain needs
`ACCESS EXCLUSIVE` on the parent. A cron job taking that lock on a live
telemetry table is not something you can do casually, so the recovery is a
migration and the job can only ever report the problem.

Measured live (SupportForge, Postgres 18, 2026-08-23): the bootstrap in a
migration created day partitions covering four days and left the rest to an
hourly job. The job failed on **every run from its first**. Ten days later the
default partition held **348,730 rows / 72 MB** across eight days, no day
partition existed past the bootstrap, and every retention drop and every
partition-pruned read for those days was operating on a table that had silently
stopped being partitioned.

Two things kept it invisible for ten days, and both are worth stating because
neither is about Postgres:

- **The job asserted "no query threw", not "the database is now correct."**
  Once the first day's rows reached the default, the pass genuinely stopped
  throwing on the paths being checked, and it recorded ten days of *successful*
  runs while the runway sat at zero. A job that creates something must read back
  what exists afterwards, not report what it attempted.
- **The job had no row in the operations UI to render red.** It wrote every
  failure to the task-runs table, and the "Scheduled Tasks" page built its list
  by mapping over a hardcoded registry the job was never added to — so the
  failures were written and then dropped on the floor at render time. A
  scheduled job that is not declared wherever jobs are displayed cannot fail
  visibly, no matter how loudly it logs.

## WRONG

```sql
-- The daily-partition job, effectively. Idempotent, ahead of the clock, and
-- unrecoverable the moment one run is missed.
CREATE OR REPLACE FUNCTION ensure_partition(parent TEXT, lo TIMESTAMPTZ, hi TIMESTAMPTZ)
RETURNS TEXT AS $$
DECLARE name TEXT := parent || '_' || to_char(lo AT TIME ZONE 'UTC', 'YYYYMMDD');
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = name) THEN RETURN name; END IF;
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                 name, parent, lo, hi);   -- <-- fails forever once the default holds day lo
  RETURN name;
END $$ LANGUAGE plpgsql;
```

```ts
// And the scheduler around it. Two separate silences in nine lines.
try {
  const outcome = await runMaintenance(db);
  // "created" is what we ATTEMPTED. Nothing reads back what exists.
  await recordTaskComplete(runId, `created ${outcome.created.length}`);

  // The one real signal, demoted to a warning nobody greps for -- and by the
  // time it is non-zero the table is already unrecoverable without a migration.
  if (outcome.defaultPartitionRows > 0) {
    console.warn(`${outcome.defaultPartitionRows} rows in the default partition`);
  }
} catch (error) {
  await recordTaskFailed(runId, String(error));   // fires only if a query throws
}
```

## RIGHT

**Recovery — drain the default in one transaction.** Detach first: while it is
attached, every `CREATE ... PARTITION OF` re-checks its constraint against every
row it holds, which is the failure itself. Detached, it is an ordinary table and
the parent has a clean range map to extend.

```sql
BEGIN;
SET LOCAL TimeZone = 'UTC';       -- partition names come from to_char; do not inherit this
SET LOCAL lock_timeout = '10s';   -- fail fast rather than queue behind a long reader
SET LOCAL statement_timeout = '10min';

DO $$
DECLARE
  before BIGINT; moved BIGINT := 0; n BIGINT; day TIMESTAMP; part TEXT;
BEGIN
  SELECT count(*) INTO before FROM metric_points_default;
  IF before = 0 THEN RETURN; END IF;

  ALTER TABLE metric_points DETACH PARTITION metric_points_default;

  FOR day IN SELECT DISTINCT date_trunc('day', bucket_at AT TIME ZONE 'UTC')
               FROM metric_points_default ORDER BY 1
  LOOP
    part := 'metric_points_' || to_char(day, 'YYYYMMDD');
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF metric_points '
                   'FOR VALUES FROM (%L) TO (%L)',
                   part, day AT TIME ZONE 'UTC', (day + INTERVAL '1 day') AT TIME ZONE 'UTC');

    -- IF NOT EXISTS matches on the NAME alone. A same-named table that is not a
    -- partition of this parent satisfies it silently, and the copy below would
    -- then move a day of data somewhere the parent cannot see -- with the row
    -- accounting still balancing perfectly.
    IF NOT EXISTS (SELECT 1 FROM pg_class c
                     JOIN pg_inherits i ON i.inhrelid = c.oid
                     JOIN pg_class p ON p.oid = i.inhparent
                    WHERE p.relname = 'metric_points' AND c.relname = part) THEN
      RAISE EXCEPTION '% is not a partition of metric_points', part;
    END IF;

    EXECUTE format('INSERT INTO %I SELECT * FROM metric_points_default '
                   'WHERE bucket_at >= %L AND bucket_at < %L',
                   part, day AT TIME ZONE 'UTC', (day + INTERVAL '1 day') AT TIME ZONE 'UTC');
    GET DIAGNOSTICS n = ROW_COUNT;
    moved := moved + n;
  END LOOP;

  -- The default is detached and the parent is under ACCESS EXCLUSIVE, so no row
  -- can have arrived. A mismatch means something was not covered by any day
  -- bound, and truncating on top of that destroys data.
  IF moved <> before THEN
    RAISE EXCEPTION 'copied % of % rows; refusing to truncate', moved, before;
  END IF;
  TRUNCATE metric_points_default;   -- rows are copied; DELETE would leave the bloat behind

  -- Create the runway HERE, while the default is detached and empty: each one is
  -- then a catalog operation with no validation scan behind it.
  FOR i IN -1..4 LOOP
    -- ... CREATE TABLE ... PARTITION OF ... for today+i ...
  END LOOP;

  ALTER TABLE metric_points ATTACH PARTITION metric_points_default DEFAULT;
END $$;
COMMIT;

ANALYZE metric_points;   -- AFTER the commit: the lock is held until then
```

**Prevention — assert on the state, not on the absence of an exception.**

```ts
// Read the runway back from the catalog. What the pass attempted and what the
// database ended up with are different facts, and only the second one keeps the
// fleet writing tomorrow. Walk FORWARD and stop at the first gap: counting
// future partitions calls "tomorrow missing, next week present" four days of
// runway, when it is zero.
export async function measureRunway(db, table, required, now) {
  const { rows } = await db.query(
    `SELECT pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = $1 AND c.relname <> $2`,
    [table, `${table}_default`],
  );
  let ahead = 0;
  for (let step = 1; step <= required; step += 1) {
    if (!covers(rows, dayAfter(now, step))) break;   // gap -> stop, do not skip it
    ahead += 1;
  }
  return ahead;
}

// Any of these three is an outage in progress or an outage scheduled.
export function describeFailure(outcome) {
  const reasons = [];
  for (const f of outcome.failures) reasons.push(`${f.table} ${f.step}: ${f.message}`);
  for (const r of outcome.runway) {
    if (r.ahead < r.required) reasons.push(`${r.table} has ${r.ahead}/${r.required} days of runway`);
  }
  if (outcome.defaultPartitionRows > 0) {
    // Name the repair. No cron job can clear this -- it needs ACCESS EXCLUSIVE
    // on the parent -- so a message without the migration in it leaves the
    // reader with nothing to do.
    reasons.push(`${outcome.defaultPartitionRows} rows in the default partition; `
               + `apply migrations/NNN_drain_metric_points_default.sql`);
  }
  return reasons.length ? reasons.join('; ') : null;
}
```

Also: **attempt every period even after one fails.** Walking several partitioned
tables in one loop that stops at the first error turns one broken table into all
of them. In the live case `metric_points` was walked first, so ten days of it
failing also froze the 5-minute and hourly rollup runways, neither of which had
anything wrong with them.

## NOTES

- **Do not skip the default partition to avoid this.** Without one an
  out-of-range INSERT fails the entire batch. The default is still correct; what
  is wrong is treating a non-zero row count in it as a warning rather than as a
  table that has already stopped healing.
- **`DETACH PARTITION CONCURRENTLY` does not help here.** It cannot run inside a
  transaction block, and the whole drain must be atomic. Plain `DETACH` inside
  one transaction is right: writers block on the parent's `ACCESS EXCLUSIVE`,
  wait, and then route correctly — whereas a parent left without a default while
  writers ran would *reject* their rows. Measured: 6.0s for 348,730 rows / 72 MB,
  inside the connection pool's 30s `statement_timeout`, so no in-flight ingest
  errored.
- **Empty the default before re-attaching.** `ATTACH ... DEFAULT` validates by
  scanning it to prove no row belongs to a sibling. Empty, that is instant; still
  populated, you pay for it under the exclusive lock.
- **Rehearse it in a rolled-back transaction, and strip the file's own
  `BEGIN`/`COMMIT` first** — see
  [A nested BEGIN/COMMIT commits the outer transaction](nested-begin-commit-ends-outer-transaction.md).
  Keep the stripped copy out of the migrations directory; it is a second,
  untransacted migration that the next deploy applies for real.
- **Withhold the `INSERT INTO schema_migrations` when applying by hand** while a
  lower-numbered migration is still undeployed, or the high-water mark strands it
  — see
  [The migration ledger's high-water mark is what decides](ledger-high-water-mark-strands-migrations.md).
- The `IF NOT EXISTS` hazard in the drain is the partition-shaped instance of
  [CREATE TABLE IF NOT EXISTS never retrofits constraints](create-table-if-not-exists-stale-constraints.md):
  the clause matches on the relation name and tells you nothing about what the
  relation actually is.
