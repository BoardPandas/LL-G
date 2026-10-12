---
tech: vitest
tags: [cloudflare, vitest-plugin, d1, miniflare, isolation, ddl, test-pollution]
severity: high
---
# @cloudflare/vitest-plugin isolates D1 per test file, not per test

## PROBLEM
`@cloudflare/vitest-plugin` 1.4.0 has no per-test storage isolation and no `isolatedStorage` option. Under Vitest's default `isolate: true`, each test FILE gets a fresh Miniflare with empty D1 databases, but nothing resets between the tests inside one file. The package README still advertises "isolated per-test storage", and `reset()` from `cloudflare:test` deletes only Durable Objects despite its typings saying "all attached bindings".

So a test that damages the schema (`ALTER TABLE ... DROP COLUMN`, `DROP TABLE`) or seeds rows silently changes every later test in the same file, and results depend on test order. Verified by probe files on one sequential worker: writes are visible to the next test in the file, and absent in the next file.

## WRONG
```ts
// test/schema.test.ts
it("healthz reports ok", async () => { /* expects every column */ });
it("healthz names a dropped column", async () => {
  await env.TABLE_DB.exec("ALTER TABLE principals DROP COLUMN rotated_at");
  // ...every test after this one in the file now sees the column missing
});
```

## RIGHT
```ts
// vitest.config.ts: re-migrate at the start of every file
test: { setupFiles: ["./test/setup.ts"] }

// test/setup.ts
await applyD1Migrations(env.TABLE_DB, env.TEST_TABLE_MIGRATIONS);

// test/schema-drift.test.ts -- the destructive test gets a file of its own
it("healthz names a dropped column", async () => {
  await env.TABLE_DB.exec("ALTER TABLE principals DROP COLUMN rotated_at");
});
```

## NOTES
- `applyD1Migrations` is idempotent (it records names in `d1_migrations`), so calling it from `setupFiles` per file is safe. Refuse an empty migration list there, or every test runs against a database with no tables.
- Setting `isolate: false` would leak storage across files too.
- Found in Roundtable F3 (2026-10).
