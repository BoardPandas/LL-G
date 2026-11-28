---
tech: postgres
tags: [trigger, write-once, immutable-column, superuser, session-replication-role, testing, fixtures]
severity: medium
---
# A guard trigger on a write-once column also fires for superusers, so a test cannot age the column with a plain UPDATE

## PROBLEM
A trigger that refuses changes to a write-once column (for example `created_at` or `issued_at`) fires for every role, superusers and the table owner included. Row-level security is skipped for superusers; triggers are not. A test that needs an old row ("this token was issued 31 days ago") therefore cannot back-date the column, even through the privileged setup connection: the `UPDATE` raises the guard's exception.

## WRONG
```sql
-- Test setup, connected as a superuser:
UPDATE device_credential SET issued_at = now() - interval '31 days' WHERE id = $1;
-- ERROR: issued_at is write-once   (raised by the guard trigger)
```

## RIGHT
```sql
-- Test setup only, as a superuser, inside a transaction:
BEGIN;
SET LOCAL session_replication_role = replica;   -- ordinary triggers do not fire
UPDATE device_credential SET issued_at = now() - interval '31 days' WHERE id = $1;
COMMIT;                                          -- SET LOCAL ends with the transaction
```

## NOTES
- `SET LOCAL` keeps the setting inside the one transaction, so it cannot leak to a pooled connection.
- Use it in test support only. The runtime role should not be able to set `session_replication_role`.
- While it is `replica`, no ordinary trigger fires for that transaction, so keep the transaction to the one statement that needs it.
