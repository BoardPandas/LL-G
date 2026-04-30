---
tech: typescript
tags: [drizzle, drizzle-kit, migrations, ORM, postgres]
severity: high
---
# drizzle-kit silent "no schema changes" when new schema file is missing from config

## PROBLEM

drizzle-kit only inspects the explicit `schema` paths listed in `drizzle.config.ts`, not the modules transitively re-exported from your barrel (e.g. `src/lib/db/schema/index.ts`).

If you add a new schema file (`src/lib/db/schema/my-table.ts`) and export it from the barrel but forget to add the same path to the `schema:` array in `drizzle.config.ts`, `pnpm db:generate` will print the existing tables and report "No schema changes, nothing to migrate" — even though the new tables exist in code. The output looks identical to a clean run, so it is easy to miss.

This silently produces a wrong migration set: your schema TS exports the new table, but the database never gets it.

## WRONG

```ts
// drizzle.config.ts — new schema file NOT listed
export default defineConfig({
  schema: [
    "./src/lib/db/schema/users.ts",
    "./src/lib/db/schema/orgs.ts",
    // ❌ forgot ./src/lib/db/schema/dsar-requests.ts
  ],
  out: "./drizzle",
  // ...
});

// src/lib/db/schema/index.ts — barrel re-exports it, but drizzle-kit doesn't read this
export * from "./users";
export * from "./orgs";
export * from "./dsar-requests"; // exists in TS, missing from migrations
```

```bash
$ pnpm db:generate
# prints existing tables, then:
# "No schema changes, nothing to migrate"  ← lies
```

## RIGHT

```ts
// drizzle.config.ts — every schema file path is explicit
export default defineConfig({
  schema: [
    "./src/lib/db/schema/users.ts",
    "./src/lib/db/schema/orgs.ts",
    "./src/lib/db/schema/dsar-requests.ts", // ✅ added when the file was created
  ],
  out: "./drizzle",
  // ...
});
```

```bash
$ pnpm db:generate
# generates 0040_<name>.sql with the new CREATE TABLE
```

## NOTES

- This is a different failure mode from `drizzle-kit-migrate-silent-skip.md` (that one is about `_journal.json` `when` ordering at apply time; this one is about discovery at generate time).
- A `schema` glob like `./src/lib/db/schema/*.ts` avoids this entirely if it fits your layout. Vigilis uses an explicit array because some files in that folder aren't tables (helpers, enums imported elsewhere) and would confuse drizzle-kit.
- After every `pnpm db:generate`, sanity-check that the generated SQL contains the tables you expected. If the migration is empty when you know you added a new table, suspect this gotcha first.
