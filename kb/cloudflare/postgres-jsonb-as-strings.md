---
tech: cloudflare
tags: [postgres, jsonb, fetch-types, hyperdrive, workers, parsing]
severity: medium
---
# postgres.js with fetch_types:false returns JSONB columns as strings

## PROBLEM
When using postgres.js on Cloudflare Workers with `fetch_types: false` (required for Hyperdrive compatibility), the driver skips its type registry lookup. JSONB columns are returned as raw JSON strings instead of parsed JavaScript objects. Accessing properties on the "object" fails silently (returns `undefined`) or throws if you try to iterate.

This is subtle because `typeof row.seeds` is `"string"`, and logging the row shows what looks like a valid object but is actually a string representation.

## WRONG
```typescript
const { rows } = await sql.unsafe(
  'SELECT * FROM styles WHERE user_id = $1', [userId]
);
// rows[0].seeds is a STRING like '{"headingFont":"Inter",...}'
// This silently fails:
const font = rows[0].seeds.headingFont; // undefined
```

## RIGHT
```typescript
function parseRow(row: Record<string, unknown>): SavedStyle {
  const seeds = typeof row.seeds === 'string'
    ? JSON.parse(row.seeds)
    : row.seeds;
  return { ...row, seeds } as SavedStyle;
}

const { rows } = await sql.unsafe(
  'SELECT * FROM styles WHERE user_id = $1', [userId]
);
const style = parseRow(rows[0] as Record<string, unknown>);
// style.seeds is now a proper object
```

## NOTES
- `fetch_types: false` is required when using Hyperdrive because Hyperdrive doesn't support the pg_types query that postgres.js uses to build its type registry.
- This affects ALL JSONB columns, not just one. Build a `parseRow()` helper per table that handles all JSONB fields.
- The `typeof` check (`typeof v === 'string' ? JSON.parse(v) : v`) makes the helper safe for both Workers (where it's a string) and local dev (where it might already be parsed).
- This also applies to JSON columns, array columns, and other complex types that postgres.js normally auto-parses.
