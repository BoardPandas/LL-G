---
tech: cloudflare
tags: [d1, batch, audit, atomicity, sqlite]
severity: high
---
# A D1 batch cannot make a later statement depend on whether an earlier one changed a row

## PROBLEM
`db.batch([...])` is atomic, so putting an audit INSERT in the same batch as an UPDATE looks like "the action and its record land together". But statements in a batch cannot read each other's `meta.changes`. If the UPDATE's WHERE matches nothing (already revoked, not the owner, wrong id), the UPDATE is a no-op and the audit row is still written: a durable record of something that did not happen.

## WRONG
```ts
await db.batch([
  db.prepare("UPDATE resources SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL")
    .bind(now, id, owner),
  db.prepare("INSERT INTO audit (action, target_id, actor_id, created_at) VALUES ('revoked', ?, ?, ?)")
    .bind(id, owner, now), // written even when the UPDATE matched nothing
]);
```

## RIGHT
```ts
await db.batch([
  // FIRST, and guarded on the state the mutation is about to change.
  db.prepare(
    `INSERT INTO audit (action, target_id, actor_id, created_at)
     SELECT 'revoked', ?, ?, ?
     WHERE EXISTS (SELECT 1 FROM resources WHERE id = ? AND owner_id = ? AND revoked_at IS NULL)`,
  ).bind(id, owner, now, id, owner),
  db.prepare("UPDATE resources SET revoked_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL")
    .bind(now, id, owner),
]);
```

## NOTES
- Order matters: the guard must run before the mutation or it sees the post-state.
- Build the guard from constants and bound parameters only.
- Test the no-op: repeat the action and assert the row count did not grow.
