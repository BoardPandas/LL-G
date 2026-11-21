---
tech: kysely
tags: [kysely, migrations, migrator, error-handling, silent-failure, rollback, revert, boot]
severity: high
---
# migrateToLatest never throws -- an unchecked result.error boots the app with no migrations run

## PROBLEM
Kysely's `Migrator` methods (`migrateToLatest`, `migrateTo`, `migrateUp`, `migrateDown`) return a `MigrationResultSet` and, per their own doc comment, "_never_ throw". Every failure comes back as `{ error }`, with `results` undefined when nothing ran. A caller that only `await`s the call, or wraps it in `try/catch`, sees success.

The failure that makes this bite is a code revert. Before running anything, the migrator checks that every migration name in its ledger table is still returned by the provider. If one is missing (the revert deleted the file, or an image was built from an older commit), it stops with `corrupted migrations: previously executed migration <name> is missing` and runs no migration at all, including new ones that are pending. With the error unchecked, the server starts against a schema that is behind the code, and the first sign is a query failing somewhere unrelated.

`allowUnorderedMigrations: true` does not help: it skips only the ordering check, not the missing-migration check.

## WRONG
```ts
import { Migrator } from "kysely";

const migrator = new Migrator({ db, provider });

try {
  await migrator.migrateToLatest(); // never throws, so this catch is dead code
} catch (err) {
  console.error("migration failed", err);
  process.exit(1);
}

startServer(); // runs even when zero migrations were applied
```

## RIGHT
```ts
import { Migrator } from "kysely";

const migrator = new Migrator({ db, provider });

const { error, results } = await migrator.migrateToLatest();

for (const r of results ?? []) {
  console.log(`migration ${r.migrationName}: ${r.status}`);
}

if (error) {
  // Covers a failed migration AND a "corrupted migrations" precondition failure.
  console.error("migration failed", error);
  process.exitCode = 1;
  throw error; // or return before starting the server
}

startServer();
```

## NOTES
- Check `error` first, then `results`. A failed run returns both: `results` lists the migrations up to and including the one that failed (`status: "Error"`), and later ones are `"NotExecuted"`.
- Add a test for the revert state: insert a ledger row whose migration the provider does not return, and assert the boot path exits non-zero.
- A rollback must never remove an applied migration file. Revert the code, keep the files under the migrations directory, and undo schema with a new forward migration.
- The same precondition also fails when an applied migration is renamed, or when a new migration sorts alphabetically before the last executed one (unless `allowUnorderedMigrations` is set).
- Verified against `src/migration/migrator.ts` at Kysely v0.29.9: the "never throws" doc comment on each public method, and `#ensureNoMissingMigrations`.
- Related: [stranded-migration-is-not-pending](../postgres/stranded-migration-is-not-pending.md).
