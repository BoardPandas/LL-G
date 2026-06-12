---
tech: prisma
tags: [migrate-dev, drift-detection, raw-sql, gin-index, drop-index, json, postgres, migrations]
severity: high
---
# Raw-SQL index not declared in schema.prisma is silently DROPped by the next migrate dev

## PROBLEM
`npx prisma migrate dev` diffs `schema.prisma` against the database. An index created via raw SQL inside a migration file exists in the database but not in the schema, so Prisma treats it as drift. Every later `migrate dev` run, for any unrelated change, auto-generates `DROP INDEX` for it and buries that statement inside the new migration's SQL. Nothing fails and no warning is shown; the index quietly disappears when the migration is applied, which surfaces later as a hard-to-diagnose performance regression.

Real case (socium-lumen-naas): migration `20260519_auto_flux_cleanup` created `data_source_mappings_identifier_gin` (a GIN index on a Json column used by webhook JSON-path lookups) via raw SQL. The unrelated migration `20260612_add_webhook_triggers` was then auto-generated with `DROP INDEX IF EXISTS "data_source_mappings_identifier_gin"` in it and nearly shipped a production performance regression.

## WRONG
```sql
-- migrations/20260519_auto_flux_cleanup/migration.sql
-- Index created by hand, never declared in schema.prisma
CREATE INDEX "data_source_mappings_identifier_gin"
  ON "data_source_mappings" USING GIN ("identifier");
```

```prisma
// schema.prisma: no matching @@index, so Prisma sees the index as drift.
// The next migrate dev for ANY change emits:
//   DROP INDEX IF EXISTS "data_source_mappings_identifier_gin"
model DataSourceMapping {
  id         String @id @default(cuid())
  identifier Json

  @@map("data_source_mappings")
}
```

## RIGHT
```prisma
// Declare the index in schema.prisma so Prisma owns it.
// Modern Prisma supports GIN natively; use map: to match the existing index name.
model DataSourceMapping {
  id         String @id @default(cuid())
  identifier Json

  @@index([identifier], type: Gin, map: "data_source_mappings_identifier_gin")
  @@map("data_source_mappings")
}
```

```sql
-- If the DROP already shipped in an applied migration, do NOT edit that migration
-- (checksum mismatch). Add a follow-up migration that restores the index:
CREATE INDEX IF NOT EXISTS "data_source_mappings_identifier_gin"
  ON "data_source_mappings" USING GIN ("identifier");
```

## NOTES
- Always review auto-generated migration SQL for unexpected `DROP` statements before committing. A migration named for feature X should not be touching objects from feature Y.
- This applies to anything created via raw SQL that Prisma can model (indexes, defaults, constraints): if the schema can express it, declare it there; otherwise Prisma's drift detection will fight you forever.
- Never edit an already-applied migration to remove the DROP. Prisma stores a checksum per migration and an edit causes a checksum mismatch error on every environment that already applied it. Roll forward with a new migration instead.
- `@@index([...], type: Gin)` requires the `postgresqlExtensions`-era Prisma versions that added index type support (Prisma 4.x+ on PostgreSQL). Use `map:` so the declared name matches the index that already exists in the database, otherwise Prisma will generate a rename.
