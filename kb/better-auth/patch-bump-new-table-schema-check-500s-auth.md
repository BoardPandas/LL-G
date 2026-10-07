---
tech: better-auth
tags: [better-auth, oauth-provider, validateSchema, schema-check, migration, upgrade, patch-release, outage, postgres, kysely]
severity: high
---
# A patch bump adds a plugin table, and 1.7.5+'s schema check 500s every auth endpoint until it exists

## PROBLEM
Since 1.7.5, `advanced.database.validateSchema` is ON by default, and the check is
not just a startup log line: every auth endpoint awaits it
(`to-auth-endpoints`: `await rawContext.checkSchema?.()`) and throws
`SchemaMismatchError` on ANY finding. One missing table therefore takes down
sign-in, `get-session`, OAuth token issuance and every MCP connector at once --
the API answers 500 on all of `/api/auth/*`.

Patch releases add tables. `@better-auth/oauth-provider` 1.7.7 declares a new
required model, `oauthClientAssertion` (`id` text PK, `expiresAt` timestamp NOT
NULL), the jti replay guard for `private_key_jwt`. Nothing in its release notes
says "migration required". A repo with hand-written SQL migrations bumps the
version, every unit test passes (tests use the memory adapter, which is never
schema-checked), the deploy succeeds and `/health` is green -- and production
auth is down. The only signal is one `ERROR [Better Auth]: Database schema
mismatch -- Missing tables oauthClientAssertion` line at boot.

## WRONG
```jsonc
// package.json -- "just a patch bump", shipped with no schema diff
"better-auth": "1.7.7",
"@better-auth/oauth-provider": "1.7.7"
// unit tests on memoryAdapter: green. deploy: green. /api/auth/get-session: 500.
```

## RIGHT
```ts
// A drift gate that runs Better Auth's OWN check against a database built from
// your migrations, in CI, BEFORE the deploy can happen.
const data = createDataAccess({ connectionString: process.env.DATABASE_URL! });
const auth = createAuth({ ...realPluginSet, database: { db: data.db, type: "postgres" } });
const pending = (await auth.$context).checkSchema?.();
expect(pending).toBeDefined();              // undefined = validation off = vacuous pass
await expect(pending).resolves.toBeUndefined(); // rejects with the exact findings
```
```sql
-- the missing table for oauth-provider 1.7.7
CREATE TABLE "oauthClientAssertion" (
  "id"        text        PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL
);
```

## NOTES
- The gate only helps if it runs before the deploy. A platform that deploys on
  push to main without waiting for CI (Railway's default) ships the outage first
  and reports the red check a minute later -- observed 2026-10-07, ~3.5 min of
  500s on every auth path. Run CI on the branch, or enable "wait for CI".
- The check is read-only catalog introspection; the oauth-provider resource
  seed is lazy (first OAuth endpoint call), so constructing auth and awaiting
  `checkSchema` writes nothing and can target a real environment.
- Fast confirm in production: `curl -s -o /dev/null -w '%{http_code}' <api>/api/auth/get-session`
  returns 500 while any finding exists, 200 once fixed (no restart needed beyond the redeploy that runs the migration).
- Setting `validateSchema: false` hides the outage, it does not fix it: the
  missing table then fails only the flows that write it.
- Related: issuer-reverted-1-7-3.md (the other 1.7.x direction: a required
  column the library stopped writing), plugin-schema-drift-on-upgrade.md.
