---
tech: better-auth
tags: [better-auth, upgrade, schema, account, issuer, migration, postgres, validateSchema, patch-release]
severity: high
---
# 1.7.3+ stops writing account.issuer -- a 1.7.0-1.7.2 schema breaks every sign-up

## PROBLEM
1.7.0-1.7.2 keyed external accounts on (issuer, accountId) and wrote `issuer` on
every account INSERT, so the migration you wrote for them (see
account-issuer-column-1-7.md) made `issuer` NOT NULL with no default. A PATCH
release, 1.7.3, reverted that: accounts are identified by (providerId, accountId)
again and the library never writes `issuer`. Upgrade to 1.7.5 on that schema and
every sign-up and account link fails on the NOT NULL. 1.7.5 also adds a
default-on schema check (`advanced.database.validateSchema`) that reports it as
`unexpected-required-column`.

A drift gate that only asks "does every column Better Auth declares exist?"
(getAuthTables vs your migrations) stays green, because the failure is the other
direction: a required column the library no longer writes.

## WRONG
```sql
-- left over from the 1.7.0 upgrade, then bump to 1.7.5
ALTER TABLE account ALTER COLUMN issuer SET NOT NULL;
CREATE UNIQUE INDEX account_issuer_account ON account(issuer, "accountId");
```

## RIGHT
```sql
-- per https://www.better-auth.com/docs/guides/1-7-upgrade-guide, on EVERY
-- Better Auth instance's account table (e.g. a portal instance's own table too)
BEGIN;
ALTER TABLE account ALTER COLUMN issuer DROP NOT NULL;
DROP INDEX IF EXISTS account_issuer_account;
COMMIT;
-- keep the column so a rollback to 1.7.2 can backfill it and re-add NOT NULL
```

## NOTES
- Deploy the migration BEFORE the 1.7.5 code if any separately deployed app runs
  its own `betterAuth` instance (e.g. a Next.js app serving /api/auth via
  `toNextJsHandler`) and can go live before the service that runs migrations.
  Relaxing NOT NULL is safe under 1.7.2, which still writes the column.
- Detect it before shipping: diff `@better-auth/core/dist/db/get-tables.mjs`
  between versions, and replay the library's own comparison read-only against
  production (`getExpectedSchema` + `diffSchema` from
  `@better-auth/core/db/internal`, `toPhysicalSchema` / `toIntrospectedTables`
  from `@better-auth/kysely-adapter`).
- 1.7.5 also removed `joins` from the `experimental` options type.
  `experimental.joins` was never read at runtime in 1.7.2 either (the adapter
  reads `advanced.database.joins`), so delete it rather than moving it, unless
  you actually mean to turn native joins on.
- Related: account-issuer-column-1-7.md, plugin-schema-drift-on-upgrade.md.
