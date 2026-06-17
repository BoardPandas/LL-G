---
tech: drizzle-kit
tags: [drizzle, drizzle-kit, migrations, schema, config, silent-failure]
severity: high
---
# drizzle-kit "No schema changes" when a new schema file isn't registered in an explicit drizzle.config schema list

## PROBLEM
When `drizzle.config.ts` lists schema files explicitly as an array (`schema: ["./src/lib/db/schema/foo.ts", ...]`) rather than a directory glob, adding a brand-new table in a NEW file and exporting it from the schema barrel (`schema/index.ts`) is NOT enough. `pnpm db:generate` reads only the files named in the config's `schema` array; it does not follow the barrel's re-exports. If the new file isn't in that array, drizzle-kit diffs against a schema that doesn't include the new table, prints `No schema changes, nothing to migrate 😴`, and exits 0. The table silently never gets a migration and is missing in every environment until someone hits it at runtime.

Detection: `db:generate` says "No schema changes" right after you added a table you are certain is new.

## WRONG
```ts
// drizzle.config.ts -- explicit file list, new file NOT added
export default defineConfig({
  schema: [
    "./src/lib/db/schema/billing.ts",
    // billing-override-audit.ts is missing here
  ],
  // ...
});
// schema/index.ts re-exports billing-override-audit -- but db:generate ignores the barrel.
// pnpm db:generate -> "No schema changes, nothing to migrate 😴" (exit 0), no CREATE TABLE.
```

## RIGHT
```ts
// drizzle.config.ts -- register every new schema file path explicitly
export default defineConfig({
  schema: [
    "./src/lib/db/schema/billing.ts",
    "./src/lib/db/schema/billing-override-audit.ts", // <-- add the new file
  ],
  // ...
});
// Now pnpm db:generate emits the CREATE TABLE migration.
```

## NOTES
- Applies only when `drizzle.config` uses an explicit file array instead of a directory glob (e.g. `"./src/lib/db/schema/*.ts"`). A glob would have picked the file up automatically.
- Secondary gotcha discovered alongside this: drizzle-kit stamps the new journal entry's `when` with the real `Date.now()`. If existing `_journal.json` entries were hand-bumped to artificially-high `when` values, the new entry can be LOWER than `max(when)`, which triggers drizzle-kit migrate's silent-skip-older-entries behavior. After generate, verify the new entry's `when` is strictly greater than the current max and bump it if not. See the related drizzle-kit-migrate silent-skip entry in kb/typescript.
