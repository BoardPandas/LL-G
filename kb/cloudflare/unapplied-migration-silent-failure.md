---
tech: cloudflare
tags: [database, migrations, schema, columns, deployment, northflank]
severity: high
---
# Unapplied migration files cause silent column-missing failures

## PROBLEM
When a migration file exists in the repository but was never executed against the production database, queries referencing the new columns fail with confusing errors. INSERT statements get "column does not exist" errors, but UPDATE statements may silently succeed (updating zero rows) if the missing column is only in the SET clause and the row still matches the WHERE clause.

This is especially dangerous in projects without automated migration runners. If migrations are applied manually or via scripts, it's easy to add a migration file, commit it, deploy, and forget to actually run it against production.

## WRONG
```
# Migration 002 exists in repo but was never run against production:
# migrations/002-add-columns.sql
ALTER TABLE custom_themes ADD COLUMN preset_id TEXT DEFAULT 'balanced';
ALTER TABLE custom_themes ADD COLUMN shade_overrides JSONB;

# Developer commits code that references these columns.
# INSERT fails at deploy time with:
#   error: column "preset_id" of relation "custom_themes" does not exist
```

## RIGHT
```bash
# After creating a migration file, always verify it was applied:

# 1. Run the migration against production
psql $DATABASE_URL -f migrations/002-add-columns.sql

# 2. Verify the columns exist
psql $DATABASE_URL -c "\d custom_themes" | grep preset_id

# 3. Consider adding a startup check that validates schema expectations
```

```typescript
// Optional: runtime schema validation on app startup
async function validateSchema(sql: postgres.Sql) {
  const { rows } = await sql.unsafe(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'custom_themes'
  `);
  const columns = new Set(rows.map(r => r.column_name));
  const required = ['id', 'user_id', 'name', 'preset_id', 'shade_overrides'];
  for (const col of required) {
    if (!columns.has(col)) {
      throw new Error(`Missing column: custom_themes.${col} -- run pending migrations`);
    }
  }
}
```

## NOTES
- This is not specific to any particular database or hosting provider -- it applies anywhere migrations are not auto-applied on deploy.
- Automated migration runners (like Drizzle Kit's `migrate()`, Prisma's `prisma migrate deploy`, or Flyway) prevent this class of bug entirely.
- If using manual migrations, add a CI check that compares the migration files against a schema dump to catch drift.
- The confusing part is that the migration file's presence in the repo makes it look like the schema change was applied. Always verify against the actual database.
