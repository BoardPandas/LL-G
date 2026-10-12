---
tech: postgres
tags: [testing, xmin, ctid, mvcc, rollback, upsert]
severity: high
---
# Detect rewritten rows with ctid, not xmin, inside one transaction

## PROBLEM
A rolled-back test that checks "did this statement rewrite the row?" by comparing `xmin` before and after reads 0 rewrites when the rows were inserted earlier in the same transaction (for example a TEMP shadow table filled with `INSERT ... SELECT`). Those rows already carry the current transaction's xid, so an `UPDATE` leaves `xmin` unchanged. The test then passes whether or not the guard works. Here it was meant to validate an `ON CONFLICT ... DO UPDATE ... WHERE (cols) IS DISTINCT FROM` guard.

## WRONG
```sql
SELECT item_key, xmin::text FROM t;  -- same before and after an UPDATE in this transaction
```

## RIGHT
```sql
SELECT item_key, ctid::text FROM t;  -- every UPDATE writes a new tuple version, so ctid changes
```

## NOTES
Mutation-test the guard: remove the WHERE clause and confirm the ctid check fails. With `xmin` it would not.
