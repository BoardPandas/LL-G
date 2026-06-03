---
tech: better-auth
tags: [cli, migrations, kysely, postgres, schema, nextjs, deployment]
severity: medium
---
# better-auth generate (Kysely/pg) introspects a LIVE database

## PROBLEM
`npx @better-auth/cli generate` with the built-in Kysely adapter (a `pg` Pool or
dialect) connects to the configured database to diff the schema before emitting it.
With no reachable DB it dies with
`SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`
(or a connection error) instead of producing SQL offline. CI, air-gapped dev, and
"generate the schema before the DB exists" workflows all break.

## WRONG
```bash
# no DATABASE_URL / DB unreachable
npx @better-auth/cli generate --output schema.sql -y
# Error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
```

## RIGHT
```bash
# Point at a reachable Postgres (a throwaway local/docker one is fine):
DATABASE_URL=postgres://u:p@localhost:5432/db npx @better-auth/cli generate -y
# OR hand-write the schema from the plugin's schema.mjs,
# OR run migrations programmatically / at boot against the real DB.
```

## NOTES
Plugins add their own tables (oidc-provider / mcp add `oauthApplication`,
`oauthAccessToken`, `oauthConsent`). To hand-write, read
`dist/plugins/<plugin>/schema.mjs` -- columns are the field names verbatim
(camelCase like `emailVerified`, `accessTokenExpiresAt`), so QUOTE them in DDL and
map `string->text`, `boolean->boolean`, `date->timestamptz`; Better Auth adds an
`id text primary key` itself.
Related Next.js deploy gotcha: `better-auth` + `@better-auth/kysely-adapter` throw a
webpack build error "`DEFAULT_MIGRATION_TABLE` is not exported from kysely" -- fix by
adding `better-auth`, `@better-auth/kysely-adapter`, and `kysely` to
`serverExternalPackages` in `next.config`.
