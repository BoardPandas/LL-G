---
tech: typescript
tags: [drizzle, drizzle-kit, migrations, postgres, not-null, backfill]
severity: high
---
# `ALTER COLUMN ... SET NOT NULL` fails on existing NULL rows; drizzle-kit doesn't add the backfill

## PROBLEM
When you flip a Drizzle column from nullable to `notNull()` and run `pnpm db:generate`, drizzle-kit emits two statements:
```sql
ALTER TABLE x ALTER COLUMN y SET DEFAULT 'value';
ALTER TABLE x ALTER COLUMN y SET NOT NULL;
```
It does NOT emit a backfill `UPDATE x SET y = 'value' WHERE y IS NULL` between them. If any existing row has `y IS NULL`, the migration fails with `column "y" contains null values` and rolls back. The error message is clear, but `drizzle-kit migrate` only shows a tail-truncated `ELIFECYCLE Command failed with exit code 1.` because the spinner overwrites the actual Postgres error.

This is silent in two ways:
1. The CLI hides the underlying Postgres error behind the spinner — you have to drop into raw `psql` to see what failed.
2. The fix (a backfill UPDATE) has to be hand-edited into the generated SQL file. There is no flag on `pnpm db:generate` to add it automatically.

## WRONG
```ts
// schema.ts: flipping from nullable to NOT NULL on a column with existing NULL rows
export const partners = pgTable("partners", {
  stripeConnectStatus: text("stripe_connect_status", { enum: STATUSES })
    .notNull()           // explodes if any row has NULL
    .default("not_connected"),
});
```

Resulting generated migration (incomplete):
```sql
-- drizzle/0038_x.sql
ALTER TABLE "partners" ALTER COLUMN "stripe_connect_status" SET DEFAULT 'not_connected';
ALTER TABLE "partners" ALTER COLUMN "stripe_connect_status" SET NOT NULL; -- explodes
```

## RIGHT
Hand-edit the generated SQL to insert a backfill UPDATE between SET DEFAULT and SET NOT NULL:
```sql
-- drizzle/0038_x.sql
ALTER TABLE "partners" ALTER COLUMN "stripe_connect_status" SET DEFAULT 'not_connected';
UPDATE "partners" SET "stripe_connect_status" = 'not_connected' WHERE "stripe_connect_status" IS NULL;
ALTER TABLE "partners" ALTER COLUMN "stripe_connect_status" SET NOT NULL;
```

Always verify on the target DB after running `pnpm db:migrate`:
```bash
psql "$DATABASE_PUBLIC_URL" -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"
```

## NOTES
- For columns being newly added with default + NOT NULL, drizzle-kit DOES the backfill correctly via `ADD COLUMN ... DEFAULT 'x' NOT NULL` (single statement). The trap is specifically the **alter-existing-column** path.
- The reverse direction (NOT NULL → nullable) is fine — Postgres relaxes the constraint without touching data.
- Pair with `drizzle-kit-migrate-silent-skip`: if the migration fails partway, the journal `when` may have been written but no rows applied to `__drizzle_migrations`; check both before retrying.
- Custom migration mode (`drizzle-kit generate --custom`) is the right escape hatch for any column flip that needs data movement, not just defaults.
