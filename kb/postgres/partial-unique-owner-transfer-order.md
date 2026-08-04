---
tech: postgres
tags: [partial-unique-index, transaction, soft-delete, ownership-transfer]
severity: medium
---
# Retire the old live owner before transferring a partial-unique key

## PROBLEM
A transaction that transfers a uniquely owned foreign key can still fail if the uniqueness rule is an immediate partial index such as `UNIQUE (connection_id) WHERE deleted_at IS NULL`. PostgreSQL checks the index after each statement, not only at commit. Assigning the key to the replacement row first therefore creates two live owners momentarily and raises a unique-constraint error, even when a later statement in the same transaction would soft-delete the old owner.

## WRONG
```sql
BEGIN;
UPDATE services SET connection_id = $1 WHERE id = $replacement;
UPDATE services SET deleted_at = now() WHERE id = $old_owner;
COMMIT;
```

## RIGHT
```sql
BEGIN;
UPDATE services SET deleted_at = now() WHERE id = $old_owner;
UPDATE services SET connection_id = $1 WHERE id = $replacement;
COMMIT;
```

## NOTES
Lock and validate both rows before the writes, and keep both statements in one transaction so any failure restores the old owner. If the constraint itself is deferrable, commit-time checking can change the ordering requirement, but partial unique indexes are not deferrable constraints.
