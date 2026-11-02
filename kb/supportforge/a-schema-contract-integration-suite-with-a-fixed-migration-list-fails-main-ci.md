---
tech: supportforge
tags: [migrations, integration-tests, ci, check-constraint, postgres, release]
severity: medium
---
# A schema-contract integration suite with a fixed migration list fails main CI when a later migration widens an enum CHECK

## PROBLEM
An integration suite that applies a hard-coded list of migrations and compares each enum CHECK to its contract cannot see a newer migration that widens that CHECK, so it fails on main after push.
It cannot fail locally: there is no Postgres on the dev box and `check:all` excludes integration suites, so every local gate is green. On main the failing CI run blocks promotion to `release`, so the feature never deploys, and every other session's push fails the same test until someone fixes it.

## WRONG
```ts
// Contract now includes 'upgrade' (added by migration 540), but the suite
// still builds its schema from the old list.
const MIGRATIONS = ['419_rmm_patch_assessment', '449_...', '466_...'] as const;
{ table: 'rmm_patch_catalog', column: 'classification', permitted: RmmPatchClassificationSchema.options },
```

## RIGHT
```ts
// Same change that widens the CHECK adds its migration (and stubs of the
// tables it touches) to the suite, and asserts any new enum column too.
const MIGRATIONS = [..., '466_...', '540_rmm_patch_ninja_parity'] as const;
// setup: CREATE TABLE clients (id varchar(50) PRIMARY KEY); ...stubs for 540's FKs
{ table: 'rmm_patch_catalog', column: 'importance', permitted: RmmPatchImportanceSchema.options },
```

## NOTES
Before pushing a migration that changes an enum CHECK, grep `src/__tests__/integration` for the table name and the migration that created it. The suite also re-runs every listed migration and its rollback, so the new migration must be idempotent and its rollback must apply against the stubs. Related: `postgres/check-constraint-narrower-than-its-type`, `supportforge/schema-dump-fixtures-lack-migrated-columns`.
