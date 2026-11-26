---
tech: postgres
tags: [rls, row-level-security, set_config, current_setting, nullif, connection-pool, uuid, multi-tenant]
severity: high
---
# A transaction-local set_config reads back as '' on a reused connection, so a uuid-casting RLS policy raises

## PROBLEM
A tenant policy keyed on `current_setting('app.tenant_id', true)::uuid` is correct on a fresh connection: the setting is unset, `current_setting(..., true)` returns NULL, the comparison is NULL and the policy matches no rows. That is the intended fail-closed behaviour.

It is not what a pooled connection does after use. Once any transaction on that connection has run `set_config('app.tenant_id', $1, true)` (transaction-local), the custom setting stays *defined* after the transaction ends and reads back as an empty string, not NULL. The next transaction that forgets to arm the setting (or a pooled connection used for a query outside the tenant wrapper) evaluates `''::uuid` and fails with `invalid input syntax for type uuid: ""` instead of seeing zero rows.

Tests that run on a fresh connection pass. The error appears only under pool reuse, and only on the code path that did not set the tenant.

## WRONG
```sql
CREATE POLICY tenant_isolation ON items
    USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Fresh connection:            zero rows
-- After a tenant transaction:  ERROR: invalid input syntax for type uuid: ""
```

## RIGHT
```sql
CREATE POLICY tenant_isolation ON items
    USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
-- Unset (NULL) and empty ('') both become NULL, so both match zero rows.
```

## NOTES
- Keep `set_config(..., true)` (transaction-local) so one tenant's scope cannot leak to the next checkout; `NULLIF` only fixes how the empty residue is read.
- Do not "fix" the error by adding `OR current_setting(...) IS NULL`: that makes an unarmed connection read every tenant.
- Add a test that runs a tenant transaction and then an unarmed read on the same pooled connection (pool size 1) and asserts zero rows, not an error.
- Related: `rls-inert-for-superuser-even-with-force.md` (the role precondition for RLS to apply at all).
