---
tech: typescript
tags: [drizzle-orm, drizzle-kit, migrations, timestamps, silent-failure, production-risk]
severity: high
---
# drizzle-kit migrate silently skips migrations with older `when` timestamps

## PROBLEM

`drizzle-kit migrate` decides which migrations to apply based solely on the `when` field in `drizzle/meta/_journal.json`, NOT by file order, hash diff, or filename. If a newly generated migration has a `when` value lower than the highest already-applied `when`, drizzle-kit treats it as already-handled and skips it. The CLI prints `[✓] migrations applied successfully!` and exits cleanly, leaving production untouched.

This happens silently when:
- A previous migration had its `when` hand-edited to a far-future value (creating a ceiling).
- The developer's clock is behind the highest applied `when`.
- A merge replays migrations from a branch that bumped timestamps.

Symptoms:
- `pnpm db:migrate` returns instantly (1-2 spinner frames, not full processing).
- New tables/columns never appear in the database.
- `SELECT count(*) FROM drizzle.__drizzle_migrations` is unchanged.
- No error, no warning. Misleading success message.

## WRONG

```jsonc
// drizzle/meta/_journal.json — newly generated migration with stale timestamp
{
  "entries": [
    { "idx": 32, "tag": "0032_faithful_wonder_man", "when": 1777593600002 },
    { "idx": 33, "tag": "0033_my_new_migration",    "when": 1761000000000 }
    // ^ when < previous when. drizzle-kit skips this entry silently.
  ]
}
```

```bash
$ pnpm db:migrate
[✓] migrations applied successfully!
# Lies. Nothing was applied.
```

## RIGHT

```jsonc
// Bump new entries so when is monotonically greater than the highest existing when.
{
  "entries": [
    { "idx": 32, "tag": "0032_faithful_wonder_man", "when": 1777593600002 },
    { "idx": 33, "tag": "0033_my_new_migration",    "when": 1777593600003 }
  ]
}
```

```bash
# After every migrate, verify on the target DB:
psql "$DATABASE_URL" -c "SELECT count(*) FROM drizzle.__drizzle_migrations"
# Or check explicitly for the new tables/columns.
```

## NOTES

- The hash in `drizzle.__drizzle_migrations` is computed from SQL content, not the timestamp. Bumping `when` only affects ordering; it does not break hash integrity or replay safety.
- Never hand-edit `when` to a far-future date without leaving headroom for subsequent auto-generated migrations.
- Consider a CI check that asserts `drizzle/meta/_journal.json` entries are strictly monotonically increasing by `when`.
- Related: see `drizzle-version-pinning.md` (pin Drizzle ORM to ^0.45.x; v1.0.0-beta changes the migration folder structure).
- Real incident: Vigilis project, drizzle-orm ^0.45.2, drizzle-kit 0.31.10. Migrations 0029-0032 had `when` values intentionally set to 1777334400000-1777593600002. Auto-generated migrations 0033-0034 received `Date.now()` values below that ceiling and were silently skipped against Railway prod.
