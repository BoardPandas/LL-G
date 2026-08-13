---
tech: postgres
tags: [transactions, savepoints, testing, verification, mocks, connection-pool, silent-failure, production-safety]
severity: high
---
# A nested BEGIN/COMMIT commits the outer transaction, so a "rolled back" verification writes to production

## PROBLEM

Postgres has no nested transactions. A second `BEGIN` on a connection that is
already in one emits `WARNING: there is already a transaction in progress` and
is otherwise ignored; the `COMMIT` that follows then commits **everything**,
including work the outer transaction thought it still owned. The final
`ROLLBACK` finds no transaction to roll back and quietly succeeds.

That is a footnote until you write the standard "verify against production
safely" harness: open a transaction, run real application code against it, roll
back. To run application code you need something shaped like the app's pool, and
the obvious shim is one connection wearing two hats:

```ts
const pool = { query: c.query, connect: async () => ({ query: c.query, release: noop }) }
```

Every service function that manages its own transaction — a publish that takes a
row lock, an outbox write, anything doing `BEGIN … COMMIT` internally — now
commits your outer transaction the first time it is called. Everything after
that point runs in autocommit. The harness still prints its results, still ends
with `ROLLBACK`, and still reports success.

Nothing errors. The only signal is a `WARNING` on a connection whose notices you
are almost certainly not printing, and the rows are in production.

It is worse than an ordinary leak because the harness is *specifically* the tool
you reached for in order to be careful, so its output is trusted: "verified in a
rolled-back transaction" gets written into a commit message and a status update
while the writes are already committed. The damage is discovered later, by
noticing data nobody created.

## WRONG

```ts
// "Safe" verification against production. It is not.
const client = new Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

const pool = {
  query: (t, v) => client.query(t, v),
  // Hands back the SAME connection. An inner BEGIN/COMMIT now straddles the
  // outer transaction instead of nesting inside it.
  connect: async () => ({ query: (t, v) => client.query(t, v), release: () => {} }),
}

await client.query('BEGIN')
try {
  await createThing(pool, {...})       // fine, no inner transaction
  await publishVersion(pool, {...})    // does BEGIN … COMMIT internally -> COMMITS EVERYTHING
  await createAnother(pool, {...})     // now running in autocommit
} finally {
  await client.query('ROLLBACK')       // "no transaction in progress" — a no-op
}
```

## RIGHT

```ts
// Translate a nested transaction into a savepoint. Inner BEGIN/COMMIT/ROLLBACK
// then compose inside the outer transaction instead of ending it.
let depth = 0
const nested = {
  query: async (text: string, values?: any[]) => {
    const verb = text.trim().toUpperCase()
    if (verb.startsWith('BEGIN'))    return client.query(`SAVEPOINT sp_${++depth}`)
    if (verb.startsWith('COMMIT'))   return client.query(`RELEASE SAVEPOINT sp_${depth--}`)
    if (verb.startsWith('ROLLBACK')) return client.query(`ROLLBACK TO SAVEPOINT sp_${depth--}`)
    return client.query(text, values)
  },
  release: () => {},
}
const pool = { query: (t, v) => client.query(t, v), connect: async () => nested }
```

```ts
// And prove the isolation rather than assuming it — inside the finally, after
// the rollback, against the real table.
} finally {
  await client.query('ROLLBACK')
  const { rows } = await client.query('SELECT COUNT(*)::int n FROM the_table')
  console.log(`after rollback -> ${rows[0].n}`)   // must be the pre-existing count
  await client.end()
}
```

```sql
-- Independent check, from another session, while writing the harness:
SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction';
```

## NOTES

- **Assert the rollback, do not trust it.** One `SELECT COUNT(*)` after the
  `ROLLBACK` turns this from a silent production write into a failed run. Any
  harness that touches a real database should end with that line, and it should
  compare against a count taken before the transaction opened.
- **Prefer a read-only verification when the function allows it.** Code that only
  reads has no transaction to escape from. Splitting a check into "read-only
  against live data" and "writes against a scratch database" removes the class
  entirely; reach for the savepoint shim only when you must exercise a writer.
- **This also reshapes production code, for the better.** A service function that
  opens its own transaction cannot participate in a caller's — so it cannot be
  wrapped in an audit transaction, an outbox, or a saga without the same bug.
  Taking a queryable and letting the caller own the transaction is the shape that
  composes; `BEGIN` belongs at the request boundary, not in the middle of a
  service layer.
- **The warning is real but useless in practice.** `node-postgres` surfaces it on
  the `notice` event, which almost nothing subscribes to. Attaching
  `client.on('notice', console.warn)` in a harness costs one line and would have
  caught this immediately.
- Same trap with any pool-shaped fake: a Jest mock whose `connect()` resolves to
  the shared mock client will happily "commit" in a test that expected a rollback
  between cases, leaking state from one test into the next.
