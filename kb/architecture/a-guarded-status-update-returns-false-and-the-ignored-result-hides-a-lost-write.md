---
tech: architecture
tags: [architecture, postgres, state-machine, terminal-state, update, rowcount, logging, background-jobs]
severity: medium
---
# A guarded status update that returns `false` hides a lost result when the caller ignores it

## PROBLEM
A common way to make a terminal state final is to let the store update a row only while it is still active: `UPDATE ... WHERE id = $1 AND status IN ('working', 'input_required')`, returning whether a row changed. That is correct, but a caller that ignores the boolean loses information. If a cancel or a shutdown already closed the row, a later "completed, here is the result" write changes nothing, and the result is dropped. Nothing is logged, and the work (with its side effects) did happen.

## WRONG
```ts
await finishTask(id, { status: "completed", result });   // returns false if the row was already closed
```

## RIGHT
```ts
const changed = await finishTask(id, { status: "completed", result });
if (!changed && !abortedByUs) {
  // closed by someone else (cancel, shutdown sweep): the writes may have landed, so leave a trace
  log.warn("task finished but its row was already closed", { taskId: id });
}
```
```sql
UPDATE tasks SET status = $2, result = $3, updated_at = now()
 WHERE id = $1 AND status IN ('working', 'input_required');   -- rowCount 0 means: already terminal
```

## NOTES
- Skip the warning when the caller itself caused the closure (it aborted the work), so the log shows only surprises.
- Return a boolean (or the row count) from every guarded write, and make "not changed" a visible branch in each caller.
- The same pattern applies to any compare-and-set: optimistic locks, leases, idempotency keys.
