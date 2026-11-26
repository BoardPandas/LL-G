---
tech: postgres
tags: [rls, row-level-security, force-row-level-security, security-definer, table-owner, multi-tenant, policy]
severity: high
---
# FORCE ROW LEVEL SECURITY hides every row from a SECURITY DEFINER function owned by the table owner

## PROBLEM
`ALTER TABLE ... FORCE ROW LEVEL SECURITY` makes policies apply to the table owner as well. A `SECURITY DEFINER` function runs as its owner, which is usually the same role that owns the tables, so under FORCE it is subject to the tenant policies like anyone else. If no policy names that role, it sees zero rows.

That breaks the usual cross-tenant "routing" lookup (resolve a tenant from an address or an external ID before any tenant is known). The function is created, granted and callable, returns an empty result with no error, and the failure looks like "no such record".

## WRONG
```sql
ALTER TABLE addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON addresses
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION route_address(addr text) RETURNS TABLE (tenant_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$ SELECT a.tenant_id FROM public.addresses AS a WHERE a.address = route_address.addr $$;
-- Owned by the table owner: always returns zero rows.
```

## RIGHT
```sql
-- A narrow read policy for the owner role, on exactly the tables the function reads.
CREATE POLICY routing_read ON addresses FOR SELECT TO table_owner USING (true);
```
The runtime role must not be a member of the owner role, or it inherits this policy and reads every tenant.

## NOTES
- Add the policy only to the tables the definer functions actually read, and only `FOR SELECT`.
- Test the function connected as the restricted runtime role, with and without the tenant setting armed. A superuser or `BYPASSRLS` connection hides the problem (see `rls-inert-for-superuser-even-with-force.md`).
- Alternative: own the function with a dedicated `BYPASSRLS` role. That is a wider grant than the one-table policy.
- Related: `set-config-residue-empty-string-breaks-uuid-rls-policy.md`.
