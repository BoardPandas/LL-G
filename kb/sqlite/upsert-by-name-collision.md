---
tech: sqlite
tags: [upsert, unique-key, name-collision, data-integrity]
severity: medium
---
# Upsert by display name silently merges unrelated records

## PROBLEM

Using a human-readable display name (directory name, project name, filename) as the lookup key for upserts causes data collision when two different entities share the same name. The second insert silently overwrites the first's data, merging two unrelated records into one.

This is common when scanning filesystem directories -- two parent directories can each contain a subdirectory named "api", "web", "app", or "utils".

## WRONG

```typescript
// Matches by name -- two repos named "api" in different directories collide
const existing = await db
  .select()
  .from(repository)
  .where(eq(repository.name, local.name));

if (existing[0]) {
  // Overwrites the first "api" repo's data with the second's
  await db.update(repository).set({ localPath: local.path, ... })
    .where(eq(repository.id, existing[0].id));
}
```

## RIGHT

Match by a truly unique identifier -- the filesystem path, a URL, or a compound key:

```typescript
// Matches by unique local path -- no collision possible
const existing = await db
  .select()
  .from(repository)
  .where(eq(repository.localPath, local.path));
```

Or use a compound key if no single field is unique:

```typescript
const existing = await db
  .select()
  .from(repository)
  .where(
    and(
      eq(repository.name, local.name),
      eq(repository.localPath, local.path)
    )
  );
```

## NOTES

- This is a data integrity issue, not a crash. The app appears to work but silently loses data.
- The name field should remain for display purposes, but never as the primary lookup key.
- Add a UNIQUE constraint on the truly unique column (e.g., `local_path`) to catch this at the DB level.
- Discovered in RepoTracker `useRepos.ts` during code review.
