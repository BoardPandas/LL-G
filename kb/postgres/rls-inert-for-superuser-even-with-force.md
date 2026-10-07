---
tech: postgres
tags: [rls, row-level-security, force-row-level-security, superuser, bypassrls, multi-tenant, set_config, current_setting, guc, connection-pool, managed-postgres]
severity: high
---
# Row-level security can be correct, tested, and completely inert: superusers bypass it even with FORCE

## PROBLEM

A migration runs `ENABLE` and `FORCE ROW LEVEL SECURITY` on every tenant table,
with policies keyed on `current_setting('app.current_org', true)`. Integration
tests (which set the GUC themselves) pass, and the docs call RLS the backstop.

Two independent gaps can make all of it do nothing:

1. **The connecting role bypasses RLS.** Superusers and `BYPASSRLS` roles skip
   every policy. `FORCE` only removes the table OWNER's exemption; it does nothing
   for a superuser. The default role in the connection string many managed
   Postgres providers hand out is a superuser.
2. **Nothing on the runtime path sets the GUC.** With a restricted role and an
   unset GUC, `current_setting(..., true)` is NULL, `organization_id = NULL` is
   NULL, and every policy returns ZERO rows -- a loud failure.

Gap 2 alone is obvious. Gap 1 hides it: as a superuser the app behaves perfectly,
which reads as evidence that RLS works. "It behaves correctly" is not evidence a
guard is running -- work out what the failure would look like (zero rows for an
unarmed read) and check for that.

## WRONG

```sql
ALTER TABLE issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON issue
  USING (organization_id = current_setting('app.current_org', true));
-- The app connects with the provider's default DATABASE_URL (a superuser)
-- and never calls set_config: every policy is skipped, every tenant is visible.
```

## RIGHT

```sql
CREATE ROLE app_user LOGIN NOSUPERUSER NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON issue TO app_user;
-- App connects as app_user. Migrations use a separate, privileged URL.
```

```ts
// Arm per transaction. The third argument `true` makes it transaction-local, so a
// pooled connection cannot carry one tenant's scope to the next checkout.
await db.transaction().execute(async (trx) => {
  await sql`select set_config('app.current_org', ${orgId}, true)`.execute(trx);
  return work(trx);
});

// Boot probe: refuse to start if the guard cannot run.
const { rows: [role] } = await sql<{ rolsuper: boolean; rolbypassrls: boolean }>`
  select rolsuper, rolbypassrls from pg_roles where rolname = current_user`.execute(db);
if (role.rolsuper || role.rolbypassrls) throw new Error('RLS is inert for this role');
```

## NOTES

- The fix is booby-trapped the other way. The day the app moves off the superuser,
  every deliberate cross-tenant read (cron sweeps, lookups that resolve the tenant
  from an API key) starts returning nothing -- silently, exit 0. Inventory them
  first and give them their own role and connection with explicit grants.
- Do not "fix" empty results by adding `OR current_setting(...) IS NULL` to a
  policy: every connection that forgets the GUC then reads every tenant. Write
  policies as allow-lists.
- Session-level `set_config(..., false)` on a pool leaks scope across requests;
  pg-pool issues no `DISCARD ALL` on release.
- Add a behavioural probe too: an unarmed read of a forced table must return 0 rows.
- A control documented as working stops people looking, which is worse than no
  control. Record the role precondition next to the policies.
