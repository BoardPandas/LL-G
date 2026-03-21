---
tech: tauri
tags: [plugin-sql, sqlite, typescript, type-error]
severity: medium
---
# plugin-sql execute().lastInsertId is number | undefined

## PROBLEM
When using `@tauri-apps/plugin-sql`, the `execute()` method returns `QueryResult` whose `lastInsertId` property is typed as `number | undefined`, not `number`. If you wrap this in a typed return like `Promise<QueryResult<number>>`, TypeScript will report a type mismatch. This only surfaces at type-check time -- runtime works fine.

## WRONG
```typescript
async function insertItem(data: string): Promise<QueryResult<number>> {
  return safeQuery(async () => {
    const db = await getDb();
    const result = await db.execute(
      "INSERT INTO items (data) VALUES (?)", [data],
    );
    return result.lastInsertId; // Type error: number | undefined is not assignable to number
  });
}
```

## RIGHT
```typescript
async function insertItem(data: string): Promise<QueryResult<number>> {
  return safeQuery(async () => {
    const db = await getDb();
    const result = await db.execute(
      "INSERT INTO items (data) VALUES (?)", [data],
    );
    return result.lastInsertId ?? 0; // Fallback for type safety
  });
}
```

## NOTES
- Applies to Tauri plugin-sql v2.x with SQLite backend.
- The undefined case theoretically happens when the SQL statement is not an INSERT, but in practice INSERT always returns a number.
- Same issue exists for rowsAffected on some query types.
