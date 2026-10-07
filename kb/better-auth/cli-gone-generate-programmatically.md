---
tech: better-auth
tags: [better-auth, cli, auth-cli, npx, migrations, schema-drift, postgres, kysely, ci, oauth-provider, jwt]
severity: high
---
# better-auth's 1.7 CLI is the `auth` package -- `npx better-auth` finds no bin, and a hand-written schema still drifts

## PROBLEM

**Corrected 2026-10-07.** This entry used to say 1.7 ships no CLI. It does: the CLI is the npm
package **`auth`**, built from `packages/cli` in the better-auth repo and released in lockstep
with it (`auth@1.7.0` and `1.7.1` shipped 2026-08-18, the same day as `better-auth` 1.7.0/1.7.1).
It provides `generate`, `migrate` and `check schema`, under two bin names: `auth` and
`better-auth`. Run it as `npx auth generate`, or add `auth` (same version as `better-auth`) as
a devDependency so a script's `better-auth generate` resolves.

What is true, and is the trap: the `better-auth` package itself declares **no `bin`**, so
`npx better-auth generate` (which resolves the package NAMED `better-auth`) fails, and the old
`@better-auth/cli` package is deprecated on npm and stops at `1.5.0-beta.13` (`latest` is
`1.4.21`). A `package.json` script calling `better-auth generate` without `auth` installed
looks configured, passes review, and fails only when someone runs it -- which nobody does,
because it is a once-a-year command.

The damage is what happens next: a hand-written SQL schema that nothing compares with the
library silently falls behind it on every version bump. Better Auth writes the new columns on **every INSERT**, Postgres rejects the statement, and the failure lands in production as a bare HTTP 500 with an empty body. Nothing catches it -- not the changelog, not the build, not `tsc`, not the test suite -- because no code path compares the migrations against what the library declares.

A single 1.6 -> 1.7 bump produced three separate outages this way, each found only after the previous fix shipped:

1. `oauthClient` lost 8 columns -> RFC 7591 dynamic client registration 500s, **no MCP connector can be added**.
2. `account.issuer` (new, required) -> **first-time social sign-in fails**; existing users unaffected because token refresh UPDATEs without it.
3. `jwks.alg` / `jwks.crv` -> **JWKS key creation fails**, taking down token signing. Latent: the existing key predates the upgrade and is only read, so it fires on the next key rotation or the first fresh environment.

Symptom 3 is the trap. Two rounds of manual dist-file diffing missed it, because a column that is only written on a code path nobody has exercised yet produces no error until much later.

The second-order gotcha: `getMigrations()` needs a live database (it diffs against it), so it is useless in CI. `getAuthTables()` is **pure** -- no database, no I/O -- and is the right tool for a drift check.

## WRONG

```jsonc
// package.json -- cannot run on 1.7.x, and points at an APPLIED migration
{
  "scripts": {
    // 1. Resolves only if the `auth` package is installed; better-auth itself has
    //    no bin, and @better-auth/cli is deprecated at 1.5.0-beta.13.
    // 2. --output overwrites 0001, already applied and recorded in _migrations,
    //    so a "successful" run silently desyncs the file from what the DB ran.
    "auth:generate": "better-auth generate --config src/auth.ts --output src/db/migrations/0001_better_auth.sql -y"
  }
}
```

```bash
# The "prevention" that does not work: eyeballing dist files on each bump.
# Misses any column written only on a code path you have not exercised yet
# (jwks.alg/crv are written on key CREATION -- never on read).
diff <(cat node_modules/better-auth/dist/plugins/jwt/schema.mjs) ...
```

## RIGHT

```ts
// scripts/check-auth-schema.mts -- runs in CI, needs NO database.
// getAuthTables() is pure: it resolves core + every plugin's schema from the
// REAL auth config, so plugin options are accounted for.
import { getAuthTables } from "@better-auth/core/db";

// Importing the auth instance starts a background DB connect. Everything below
// is synchronous and exits before that settles; this keeps a stray rejection
// from reddening a clean run. (Or export the options object without `database`.)
process.on("unhandledRejection", () => {});
const { auth } = await import("../src/auth");

const declared = getAuthTables(auth.options);
const schema = buildSchemaFromMigrationFiles(); // replay your .sql files

for (const model of Object.values(declared)) {
  const columns = schema.get(model.modelName);
  if (!columns) fail(`table "${model.modelName}" is never created`);
  if (!columns.has("id")) fail(`"${model.modelName}"."id" missing`); // id is implicit
  for (const [field, attr] of Object.entries(model.fields)) {
    const column = attr.fieldName ?? field;          // honour fieldName overrides
    if (!columns.has(column)) fail(`"${model.modelName}"."${column}" missing`);
  }
}
// Extra columns should WARN, not fail: an upgrade that DROPS a field (1.7 removed
// oauthClient.public/.type) leaves harmless unused columns behind.
```

```ts
// scripts/auth-generate-migration.mts -- the programmatic equivalent of `npx auth generate`
// (same entry point the CLI drives), useful when you want the file naming and placement under
// your own control. Emits a DELTA, so it belongs in a NEW file.
import { getMigrations } from "better-auth/db/migration";

const { toBeCreated, toBeAdded, unsafeChanges, compileMigrations } =
  await getMigrations(auth.options, { throwOnUnsafe: false });

if (!toBeCreated.length && !toBeAdded.length) process.exit(0); // write nothing
// Allocate ABOVE the highest existing number, leave gaps, never reuse a slot.
fs.writeFileSync(`migrations/${next}_${slug}.sql`, await compileMigrations());
// unsafeChanges = required column, no default, populated table.
// Fix by hand: add nullable -> backfill -> SET NOT NULL.
```

```yaml
# CI -- before the build: cheapest failure in the file, costliest bug.
- run: npm ci
- run: npm run auth:check
- run: npm run build
```

## NOTES

- **Verify the claims yourself, they change per release:**
  `npm view auth@<your better-auth version> bin repository.directory` -> `{ auth, better-auth }`,
  `packages/cli` (checked on 1.7.7).
  `node -e "console.log(require('better-auth/package.json').bin)"` -> `undefined` (1.7.1-1.7.7).
  `npm view @better-auth/cli dist-tags` -> `latest: 1.4.21`, `beta: 1.5.0-beta.13`, deprecated.
- `npx auth generate` / `migrate` on the Kysely adapter introspect a LIVE database
  ([generate-needs-live-db.md](generate-needs-live-db.md)), so neither replaces an offline CI
  gate. `npx auth check schema` also needs the database. Since 1.7.5 the same comparison runs at
  runtime before every auth endpoint and refuses them all on a finding -- see
  [patch-bump-new-table-schema-check-500s-auth.md](patch-bump-new-table-schema-check-500s-auth.md)
  for gating on it in CI.
- `getAuthTables()` returns `{ [key]: { modelName, fields, indexes } }`. Use `modelName` for the
  table (it can differ from the key) and `attr.fieldName ?? key` for the column. `id` is implicit
  and absent from `fields`.
- Import path is `@better-auth/core/db` (a dependency of `better-auth`, resolvable without
  declaring it), and `better-auth/db/migration` for `getMigrations`.
- Prefer resolving from the real `auth.options` over a hand-built options object -- a duplicated
  config is one more thing that can drift, which is the bug you are trying to catch.
- If the check must import your auth module, note that `betterAuth()` opens a connection eagerly.
  Cleanest fix is exporting the options separately from the instance; the `unhandledRejection`
  guard above is the low-churn alternative when the file is being edited concurrently.
- Related: [generate-needs-live-db.md](generate-needs-live-db.md) (why `getMigrations` cannot run
  in CI), [plugin-schema-drift-on-upgrade.md](plugin-schema-drift-on-upgrade.md) (the same drift
  class against a Drizzle schema), [oauth-provider-mcp.md](oauth-provider-mcp.md) (pinning the
  lagging CLI).
- Postgres-side companion: a duplicate migration NUMBER is a real hazard when two agent sessions
  allocate a file at once. Cheap to fold into the same check -- reject two files sharing a numeric
  prefix.
