---
tech: postgres
tags: [update, returning, order-by, skip-locked, job-queue, ordering]
severity: high
---
# UPDATE ... RETURNING does not keep the subquery's ORDER BY

## PROBLEM
The common job-claim pattern `UPDATE t SET state = 'claimed' WHERE id IN (SELECT id ... ORDER BY due_at, id LIMIT n FOR UPDATE SKIP LOCKED) RETURNING ...` uses the ORDER BY only to choose *which* rows are claimed. The rows that come back from `RETURNING` are in whatever order the update produced them, not the subquery's order.

Code that loops over the returned rows in order therefore processes them in an arbitrary order. This silently breaks any logic where order matters. In one case, a "final" stage that closes its parent record and a sibling stage due at the same instant were processed final-first, so the sibling was skipped as "already closed". Unit tests passed because the fake database sorted the claimed rows itself. Only a real-Postgres integration test exposed it.

## WRONG
```ts
const { rows } = await db.query(`
  UPDATE stages st SET state = 'claimed'
   WHERE st.id IN (
     SELECT id FROM stages
      WHERE state = 'scheduled' AND due_at <= $1
      ORDER BY due_at, id
      LIMIT 50 FOR UPDATE SKIP LOCKED)
  RETURNING st.id, st.stage, st.due_at`, [now]);
for (const row of rows) await process(row); // order not guaranteed
```

## RIGHT
```ts
const { rows } = await db.query(/* same claim query */);
// RETURNING does not keep the subquery's order, so apply it again.
const ordered = [...rows].sort((a, b) =>
  new Date(a.due_at).getTime() - new Date(b.due_at).getTime() ||
  Number(a.id) - Number(b.id));
for (const row of ordered) await process(row);
```

You can also wrap the UPDATE in a CTE and `SELECT ... FROM claimed ORDER BY ...` outside it.

## NOTES
- Put any tie-break rule (for example "the closing stage goes last among equal due times") in both the claim subquery's ORDER BY, so batch boundaries respect it, and in the re-sort.
- Prove it against real Postgres with a mutation test. Removing the re-sort should fail the ordering test. A fake query layer that returns rows sorted hides the bug.
