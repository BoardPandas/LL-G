---
tech: architecture
tags: [hooks, side-effects, cross-feature, sql, status, sync]
severity: high
---
# A cross-feature hook on one helper misses every path that writes the column itself

## PROBLEM
A new feature needs to react when a record changes state, for example "when a ticket is
solved, complete its follow-up task". The spec names the helper that changes the status,
so the hook goes there. The tests call that helper and pass.

In a codebase of any age that helper is rarely the only writer. Bulk actions, a
merge/close-as-duplicate path, an automation engine, an integration that auto-closes,
and the generic update route each carry their own `UPDATE ... SET status = ...`. In the
build that produced this entry the named helper had one caller and six other paths wrote
the same column in their own SQL, including the path the main page uses. The reaction
never ran for most real changes, nothing failed, and no test covered it because every
test went through the helper.

## WRONG
```ts
// The only place the reaction lives.
export async function applyStatusChange(id: string, status: Status) {
  await db.query('UPDATE tickets SET status = $1 WHERE id = $2', [status, id]);
  await onStatusWritten(id, status); // new hook
}

// Elsewhere, untouched and unhooked:
await db.query('UPDATE tickets SET status = $1 WHERE id = ANY($2)', ['closed', ids]); // bulk
await db.query("UPDATE tickets SET status = 'solved', merged_into = $1 WHERE id = $2", [a, b]); // merge
```

## RIGHT
```bash
# Before choosing where the hook lives, list every writer of the column.
grep -rnE "SET[^;]*\bstatus\s*=" src/ --include='*.ts' | grep -v test
grep -rnE "status:\s" src/ --include='*.ts' | grep -iE "update|patch"
```

```ts
// One exported reaction, called by every writer after its own commit.
export async function statusWritten(ids: string[], status: Status): Promise<void> { /* ... */ }

await db.query('UPDATE tickets SET status = $1 WHERE id = ANY($2)', ['closed', ids]);
await statusWritten(ids, 'closed');
```

## NOTES
- Add one test per writer that asserts the reaction ran. A test through the helper only
  proves the helper.
- Writers that cannot take the hook (a bulk upsert in a sync job, a raw migration) should
  be listed as known gaps in the feature's docs, so the miss is a decision.
- A database trigger covers every writer, but it runs inside the writer's transaction
  and cannot do after-commit work such as notifications.
- A guard test that greps for new unhooked writers of the column keeps the list from
  growing again.
