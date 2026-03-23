---
tech: tauri
tags: [tauri, sqlite, migration, seed, timing, plugin-sql]
severity: high
---
# Migration UPDATEs silently fail when seed data does not exist yet

## PROBLEM
In Tauri apps using plugin-sql with SQLite, migrations run during `getDb()` initialization BEFORE seed functions like `seedLanguageData()`. If a migration contains UPDATE statements that depend on seeded data (e.g., `UPDATE language_items SET lesson_group = 'vocab-pronouns' WHERE jlpt_level = 'N5'`), those UPDATEs match 0 rows because the table is empty. The migration commits successfully and `schema_version` increments, so it never re-runs. The data permanently lacks the intended updates with no error or warning.

## WRONG
```typescript
// In migrations.ts -- runs BEFORE seed data exists
{
  version: 15,
  up: [
    // These UPDATEs match 0 rows because seedLanguageData() hasn't run yet
    `UPDATE language_items SET lesson_group = 'vocab-pronouns', lesson_order = 1
    WHERE content_type = 'vocabulary' AND jlpt_level = 'N5'
    AND LOWER(part_of_speech) LIKE '%pronoun%'`,
  ],
}

// In main.ts
await getDb();           // runs migrations (v15 UPDATEs hit empty table)
await seedLanguageData(); // inserts data AFTER migrations already committed
```

## RIGHT
```typescript
// Post-seed fixup function gated by a settings flag
export async function applyVocabTopicOrdering(): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = 'vocab_topics_v1'",
  );
  if (rows.length > 0) return; // already applied

  const updates = [
    `UPDATE language_items SET lesson_group = 'vocab-pronouns', lesson_order = 1
    WHERE content_type = 'vocabulary' AND jlpt_level = 'N5'
    AND LOWER(part_of_speech) LIKE '%pronoun%'`,
  ];

  await db.execute("BEGIN");
  try {
    for (const stmt of updates) { await db.execute(stmt); }
    await db.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('vocab_topics_v1', 'true')");
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK").catch(() => {});
  }
}

// In main.ts -- fixup runs AFTER seed
await getDb();
await seedLanguageData();
await applyVocabTopicOrdering(); // runs after data exists
```

## NOTES
- The migration itself is fine for pre-existing data (users who already had seeded data before the migration was added). The fixup handles both cases: existing users (migration already ran, fixup fills gaps) and new users (migration ran on empty table, fixup applies after seed).
- Use a settings flag (e.g., `vocab_topics_v1`) to make the fixup idempotent. Each fixup checks the flag and returns early if already applied.
- All UPDATE statements should include `AND target_column IS NULL` to avoid overwriting values that were correctly set by the migration for existing users.
