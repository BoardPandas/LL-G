---
tech: postgres
tags: [triggers, ddl, partitioning, legal-holds, audit, multi-tenant, deadlock]
severity: high
---
# DDL fires no row trigger, so a BEFORE DELETE guard stops applying the moment a path stops using DELETE

## PROBLEM

A guard implemented as `BEFORE DELETE ... FOR EACH ROW` -- legal holds, tenancy
checks, append-only audit, "you may not delete a row someone still needs" --
protects exactly one verb. `DROP TABLE`, `ALTER TABLE ... DETACH PARTITION` and
`TRUNCATE` do not fire it. Neither does the planner warn, nor does anything fail:
the DDL succeeds and the guard is simply absent.

This is easy to miss because the guard's own tests keep passing. They delete
rows, so they exercise the trigger, and they go green. What changed is a
*different* code path -- retention switching from row deletion to dropping whole
partitions, an archival job switching to TRUNCATE -- and that path was never in
the guard's test set because it did not exist when the guard was written.

Seen live: a shared daily partition holds every tenant's rows (`tenant_id` an
ordinary column, never part of the partition key). Retention moved from `DELETE`
to `DROP TABLE` for reclamation reasons, and in doing so silently acquired the
ability to destroy a day of data that was under legal hold, and to destroy it
without writing the audit record the row path had written for six years.

`TRUNCATE` has its own `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger, so that
one at least *can* be guarded -- but only if someone wrote a second trigger.
There is no DDL equivalent for `DROP TABLE` at all: an event trigger can see it,
but not with the `OLD` row context a hold check needs.

## WRONG

```sql
-- The guard. Correct, and load-bearing, for six years.
CREATE FUNCTION hold_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM governance_lock();
  IF is_held(OLD.tenant_id, TG_ARGV[0]) THEN
    RAISE EXCEPTION 'Data is protected by a legal hold' USING ERRCODE='restrict_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER points_hold BEFORE DELETE ON metric_points
  FOR EACH ROW EXECUTE FUNCTION hold_guard('telemetry');
```

```js
// The new path. Fires nothing. Destroys held data, writes no audit record,
// and returns success.
await tx.query(`DROP TABLE "${partition}"`);
```

## RIGHT

Re-express the guard in the code that performs the DDL, and make it atomic with
the DDL by taking the *same* lock the guard took:

```js
await withTransaction(pool, async tx => {
  await tx.query(`SET LOCAL lock_timeout = '3s'`);

  // try, NOT pg_advisory_xact_lock -- see the deadlock below
  const lock = await tx.query('SELECT pg_try_advisory_xact_lock($1,$2) AS ok', [NS, ID]);
  if (lock.rows[0]?.ok !== true) return 'lock';

  const held = await tx.query(
    `SELECT 1 FROM legal_holds
      WHERE category IN ('all','telemetry') AND released_at IS NULL LIMIT 1`);
  if ((held.rowCount ?? 0) > 0) return 'hold';

  // audit BEFORE the DDL, in this transaction, so a failed audit write
  // rolls the destruction back with it
  await appendAuditRecords(tx, tenants, partition);
  await tx.query(`DROP TABLE "${partition}"`);
});
```

The lock matters as much as the check. Whatever serializes hold *creation* --
here an advisory lock taken by `createHold` before it inserts -- must be held
across the check and the DDL, or a hold committed a millisecond after the read
loses exactly the data it was created to preserve.

## NOTES

**The ABBA deadlock this introduces.** The row sweep's `DELETE` takes
RowExclusive on the table and *then* takes the advisory lock from inside the
trigger. The DDL path wants the reverse: advisory lock first, then a table lock
that conflicts with RowExclusive. Two jobs on the same schedule will deadlock.
Postgres detects it and aborts one side with `40P01`, so it is survivable but
recurring. Do not queue for either lock: `pg_try_advisory_xact_lock` plus
`SET LOCAL lock_timeout`, and classify `55P03`, `40P01` and `42P01` as skips to
be retried next pass rather than failures. Leave the acquisition-order reasoning
in a comment -- it is exactly the kind of thing a later reader "simplifies" back
into a blocking acquire.

**Testing.** A pass-level check placed before the loop will mask a missing
in-transaction one: every ordinary test passes with the atomic check deleted.
Write a test where the hold appears *between* the pass-level read and the DDL,
and mutation-test it by removing the in-transaction check. Ours survived eight
other mutations and only that one caught it.

Audit the other direction too: grep for every `BEFORE DELETE ... FOR EACH ROW`
trigger and ask which paths now reach that table by a verb other than DELETE.

Related: shared-partition-maximum-retention.md.
