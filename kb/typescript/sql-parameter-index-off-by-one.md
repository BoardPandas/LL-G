---
tech: typescript
tags: [sql, parameterized-queries, dynamic-update, off-by-one, postgres]
severity: high
---
# SQL parameter index off-by-one in dynamic UPDATE builders

## PROBLEM
When dynamically building SQL UPDATE statements with `$1, $2, ...` parameter placeholders, appending extra fields (like `updated_at`) after the loop shifts the WHERE clause indices. The query executes without error but matches zero rows because `id` gets compared against a timestamp value and `user_id` against the theme ID. The update silently does nothing.

This is especially dangerous because:
- No SQL error is thrown (the types are all TEXT/TIMESTAMPTZ, valid for comparison)
- The function returns null, which callers often treat as "not found" rather than "bug"
- The bug only manifests when there are dynamically-built SET fields before the WHERE clause

## WRONG
```typescript
const fields: string[] = [];
const values: unknown[] = [];
let idx = 1;

for (const [key, value] of Object.entries(updates)) {
  if (!ALLOWED_FIELDS.has(key)) continue;
  fields.push(`${key} = $${idx++}`);
  values.push(key === 'seeds' ? JSON.stringify(value) : value);
}

// Append updated_at
fields.push(`updated_at = $${idx++}`);
values.push(new Date().toISOString());

// BUG: idx is now 4 (after 2 fields + updated_at)
// But we push id and user_id AFTER, so they're at positions 4 and 5
values.push(id);      // $4
values.push(user.id); // $5

// WHERE uses idx-1 and idx, but idx was already incremented past updated_at
// Result: id compared to updated_at value, user_id compared to id value
const sql = `UPDATE themes SET ${fields.join(', ')}
  WHERE id = $${idx - 1} AND user_id = $${idx}`;
//                ^ wrong           ^ wrong
```

## RIGHT
```typescript
const fields: string[] = [];
const values: unknown[] = [];
let idx = 1;

for (const [key, value] of Object.entries(updates)) {
  if (!ALLOWED_FIELDS.has(key)) continue;
  fields.push(`${key} = $${idx++}`);
  values.push(key === 'seeds' ? JSON.stringify(value) : value);
}

fields.push(`updated_at = $${idx++}`);
values.push(new Date().toISOString());

// Push WHERE values and capture their exact indices
values.push(id);
const idIdx = idx++;
values.push(user.id);
const userIdx = idx++;

const sql = `UPDATE themes SET ${fields.join(', ')}
  WHERE id = $${idIdx} AND user_id = $${userIdx}`;
```

## NOTES
- This is a general parameterized SQL gotcha, not specific to any ORM or database library.
- The safest pattern is to always assign the index at the same time you push the value.
- Consider using an ORM's update builder (Drizzle, Kysely) instead of hand-rolling dynamic SQL to avoid this class of bug entirely.
- The silent failure makes this extremely hard to debug -- the function just returns null/empty, looking like a "no matching row" result.
