---
tech: postgres
tags: [transactions, concurrent-index, snapshots, node-postgres, migrations]
severity: high
---
# Awaiting a concurrent index build inside a request transaction can stall itself

## PROBLEM

A request starts a device-ownership transaction, then awaits a legacy schema
initializer using another pool connection. The initializer builds an index with
CREATE INDEX CONCURRENTLY. Moving it to another connection avoids PostgreSQL's
ban on concurrent index builds inside a transaction, but does not remove its
snapshot dependencies. The build can wait for the request transaction to finish,
while that transaction is awaiting the index build before it can commit.

In a real Express/node-postgres test on PostgreSQL 18, the first authenticated
telemetry request timed out after six seconds. Restoring the initializer reproduced
the failure. pg_stat_progress_create_index reported `waiting for old snapshots`,
one outstanding locker, and pg_stat_activity reported a `virtualxid` lock wait.
Removing request-time schema initialization restored the successful write. A
simplified two-connection probe without the real admission queries did not
reproduce it, so do not assume every concurrent index build has the same blocker.

## WRONG

```ts
await withDeviceTransaction(async tx => {
  await authorizeDevice(tx);
  await ensureTableAndConcurrentIndexes(pool); // another connection can wait on tx
  await tx.query('INSERT INTO telemetry ...');
});
```

## RIGHT

```ts
// Create the table/indexes in a migration and verify their existence on deploy.
await withDeviceTransaction(async tx => {
  await authorizeDevice(tx);
  await tx.query('INSERT INTO telemetry ...');
});
```

## NOTES

- If runtime setup is unavoidable, complete it before opening the protected
  transaction, then re-authorize inside the transaction that performs the write.
- Do not release the authorization lock around INSERT to fix the stall.
- Observe pg_stat_progress_create_index and pg_blocking_pids rather than assuming
  that CONCURRENTLY means the build never waits.
- Check a cold schema without the indexes; a warm production schema hides this.
- [PostgreSQL 18 concurrent index build documentation](https://www.postgresql.org/docs/18/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).
