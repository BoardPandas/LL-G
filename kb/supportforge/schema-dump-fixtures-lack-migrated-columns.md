---
tech: supportforge
tags: [postgres, integration-tests, schema-dump, migrations, fixtures, jest, ci, lifecycle-stage]
severity: medium
---
# A filter on a migration-added column passes check:all and breaks CI suites built from schema.sql

## PROBLEM
`database/schema.sql` is a dump that lags the migrations. Columns and tables added since it was taken (`clients.lifecycle_stage` from migration 427, `staff_workspace_access` from 426) are not in it. Several Postgres integration suites build their tables from that dump, either through `bootAppOnTestDatabase()`, which loads the whole file, or by copying one `CREATE TABLE public.<name>` block out of it into a TEMP table. Others hand-write a minimal `CREATE TABLE clients (id, msp_id, name)`.

So adding `AND c.lifecycle_stage = 'customer'` to a route or service query looks finished locally. Every unit test mocks `db.query` and checks only that the SQL string contains the predicate, `pnpm run check:all` is green, and nothing local touches Postgres. In CI, the "PostgreSQL and Redis integration" job then fails with `column "lifecycle_stage" does not exist` or `column c.lifecycle_stage does not exist` (inside a 500 the test only sees as a status). It fails in suites that never mention the feature, such as `security.integration` reaching `GET /clients` or `inventory-workspace-query.integration` reaching the inventory org list.

The same trap catches a new full-app suite once a route gains a workspace gate: `relation "staff_workspace_access" does not exist`, because migration 426 is not in the dump either.

## WRONG
```ts
// Change the query, run check:all, push.
whereClause += ` AND c.lifecycle_stage = 'customer'`;
// Unit test: mocked db.query, asserts the SQL text. Green.
// CI integration: fixtures built from schema.sql have no such column. Red.
```

## RIGHT
```bash
# 1. Find every integration suite that can reach the changed query, including
#    through the full app, and check how each builds its tables.
grep -rln "<route path>|<function name>" src/__tests__/**/*.integration.test.ts
grep -n "CREATE TABLE public.clients" -A60 database/schema.sql | grep lifecycle_stage  # empty = stale

# 2. Give each fixture the column the way the repo already does.
#    Full-app suites: apply the migration (tenant-isolation does this).
#    TEMP tables copied from the dump: ALTER TABLE ... ADD COLUMN ... DEFAULT 'customer'.
#    Hand-written CREATE TABLEs: add the column to the DDL.

# 3. Run the suites against a real Postgres before pushing.
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/sf_test \
  npx jest --config jest.config.integration.js --runInBand <suites>
```

```ts
// Full-app suite: apply what the dump predates, then seed a non-customer row
// so the test proves the exclusion instead of just not crashing.
for (const m of ['426_staff_workspace_access.sql', '427_lifecycle_stage.sql']) {
  await database.query(readFileSync(resolve(__dirname, '../../database/migrations', m), 'utf8'));
}
```

## NOTES
- The helper says so itself (`src/__tests__/helpers/app-database.ts`): "schema.sql is a dump and lags the migrations. A suite that needs a table or column newer than the dump should apply that migration file through query()". The trap is that the suite needing it is often not one you wrote or touched.
- In CI only `TEST_DATABASE_URL` is set. Suites keyed on another variable, such as `TIME_REPORT_CORRECTION_TEST_DATABASE_URL`, skip there, so a broken fixture in one of them stays hidden until someone runs it. That suite also refuses any database not named `supportforge_time_report_test_mutations<suffix>`.
- A local cluster runs fine from `/usr/lib/postgresql/16/bin`. Keep the data directory outside a sandbox-managed scratch directory: one whose permissions are reset under it kills the postmaster mid-run with `could not open file ... pg_control: Permission denied`.
- The same real-database run surfaced a production 500 that every mocked test had passed: the MSP-wide report compared `tickets.organization_id` (bigint) to text ids with `IN (subquery)`. Compare as `organization_id::text`. See also `single-key-ticket-aggregates-undercount.md` and `dual-key-scope-outlives-its-psa.md`.
- Related: `createapp-test-msp-id-billing-503.md` (another way a test environment differs from production without saying so).
