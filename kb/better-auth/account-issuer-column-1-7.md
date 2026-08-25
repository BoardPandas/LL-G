---
tech: better-auth
tags: [migration, schema, oauth, social-sign-in, kysely, account, issuer, 1.7, upgrade]
severity: high
---
# 1.7 adds a REQUIRED account.issuer column and social sign-in dies at the callback

## PROBLEM

Better Auth 1.7 changed how an external account is identified. It was
`(providerId, accountId)`; it is now `(issuer, accountId)`, backed by a new **required**
`account.issuer` column and a unique index on the new pair.

If your schema is hand-written SQL (or any migration the CLI did not generate), the column is
simply absent, and nothing warns you:

- **The app boots normally.** Providers are registered, `/health` is green, existing sessions
  keep working. Nothing touches `account.issuer` until somebody signs in with a provider.
- **The OAuth round trip succeeds.** The user reaches Google/Microsoft, authenticates, and is
  redirected back. The failure is *after* the provider, in `handleOAuthUserInfo` ->
  `findAccountOwnerByKey`, which is the first query naming the column.
- **The error is converted into a redirect.** Better Auth catches the database error and
  redirects to `` `${baseURL}/error` `` — i.e. the **API's** origin, not the app's. With a
  separate SPA host, the person lands on a bare API URL (typically a 404 JSON body) and the
  browser console shows only `?error=internal_server_error`. Nothing names a column.

Postgres reports `column account.issuer does not exist`, SQLSTATE `42703`, but only in the
server log — and only if you are looking at the right service at the right moment.

Magic link, email/password and existing sessions are all unaffected, so "auth" appears to work
and only the social buttons are dead.

## WRONG

```sql
-- Hand-written schema carried over from Better Auth 1.6. Still compiles, still boots,
-- still passes tests that do not exercise an OAuth callback.
CREATE TABLE "account" (
  "id"         text PRIMARY KEY,
  "userId"     text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accountId"  text NOT NULL,
  "providerId" text NOT NULL,
  "password"   text,
  ...
);
CREATE UNIQUE INDEX account_provider_account_key ON "account" ("providerId", "accountId");
-- No "issuer" column, and the unique key is the pre-1.7 pair.
```

```
# What you actually see. No column is named anywhere the user or the SPA can reach:
GET https://api.example.com/?error=internal_server_error   404 (Not Found)
{"error":"not_found"}
```

## RIGHT

```sql
-- Add the column, backfill only what can be DERIVED, then enforce and re-key.
ALTER TABLE "account" ADD COLUMN "issuer" text;

-- Better Auth's issuer values (1.7 upgrade guide):
--   local password account -> 'local:credential', with "accountId" = the user's own id
--   OIDC provider          -> its exact issuer URL
--   OAuth, no issuer       -> 'local:oauth:<percent-encoded providerId>'
UPDATE "account" SET "issuer" = 'local:credential', "accountId" = "userId"
 WHERE "providerId" = 'credential';
UPDATE "account" SET "issuer" = 'https://accounts.google.com'
 WHERE "providerId" = 'google';

-- REFUSE rather than guess. Microsoft's issuer embeds the directory (tenant) id --
-- https://login.microsoftonline.com/<tenant>/v2.0 -- and is not recoverable from what is
-- stored. A guessed issuer either fails to match its owner later or matches someone else.
DO $$
DECLARE stranded bigint;
BEGIN
  SELECT count(*) INTO stranded FROM "account" WHERE "issuer" IS NULL;
  IF stranded > 0 THEN
    RAISE EXCEPTION 'account.issuer underivable for % row(s); backfill by hand first', stranded;
  END IF;
END
$$;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

-- The old pair is no longer the identity, and leaving it enforced rejects the case the new
-- key exists to allow: the same subject id from two different directories under one provider.
DROP INDEX account_provider_account_key;
CREATE UNIQUE INDEX account_issuer_account_key ON "account" ("issuer", "accountId");
```

```js
// Diff against the AUTHORITATIVE field list rather than fixing one column and hitting the next.
// The core package is the source of truth for the built-in tables:
//   node_modules/@better-auth/core/dist/db/get-tables.mjs   (user, session, account, verification)
//   node_modules/better-auth/dist/plugins/<name>/           (plugin tables)
// Note it is a transitive dep, so import it from a package that actually depends on better-auth.
```

## NOTES

**This is not the same as the Drizzle drift entry.**
[plugin-schema-drift-on-upgrade.md](plugin-schema-drift-on-upgrade.md) covers the same class of
problem but prescribes a Drizzle-specific fix whose critical step — "redeploy the code carrying
the updated schema object, because the adapter validates against your in-process schema" — does
**not** apply to the Kysely adapter. Kysely reads Better Auth's own internal field definitions,
so the database column is the only thing to change. Following the Drizzle entry on a Kysely
project leaves you looking for a schema object that does not exist.

Better Auth 1.7 also **ships no CLI**, so `npx auth generate` / `@better-auth/cli` is not
available to diff for you. Generate programmatically with `getMigrations(config)` — pass
`{ throwOnUnsafe: false }` to get the plan plus an `unsafeChanges` list instead of a throw. Note
it introspects a **live** database, so point it at a real one.

`getMigrations` deliberately **refuses** to add a required column with no default to a populated
table (`UnsafeMigrationError`) — exactly the case here. That refusal is a feature: it is telling
you the backfill is yours to decide, because it cannot know your issuers.

Verify after deploying: the pre-deploy/migration log should name the file, and a real OAuth
sign-in is the only true proof. A `state_mismatch` error afterwards is a *different* and benign
failure (a stale in-flight callback), not this bug.
