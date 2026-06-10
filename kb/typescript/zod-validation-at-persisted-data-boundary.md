---
tech: typescript
tags: [zod, validation, persistence, schema-migration, json, load-boundary]
severity: high
---
# Adding Zod validation at a persisted-data load boundary can brick old data

## PROBLEM
Replacing an unvalidated load (`JSON.parse(...) as T`) with `schema.parse(...)` is the right move, but persisted records (files on disk, DB JSON columns) were written across the schema's whole history. Records that predate newer fields, or that carry extra keys from older/newer writers, fail strict validation the moment the new code ships. Previously-working data becomes unreadable in production, and the failure looks like data corruption rather than a schema mismatch.

The trap is invisible in dev because dev data is fresh and matches the current schema.

## WRONG
```ts
// "Fixing" the unvalidated boundary with a strict schema:
function load(path: string): Manifest {
  return ManifestSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
  // Strict schema rejects records written before `newField` existed
  // or records carrying unknown keys. Every old file now throws at load.
}
```

## RIGHT
```ts
// 1. Loose schema at the load boundary: new fields optional, unknown keys pass through
const ManifestLoose = ManifestSchema.passthrough(); // zod v4: .loose()

function load(path: string): LoadResult<Manifest> {
  const parsed = ManifestLoose.safeParse(JSON.parse(readFileSync(path, "utf-8")));
  if (!parsed.success) {
    console.error("[load] corrupt manifest", path, parsed.error.issues.slice(0, 3));
    return { ok: false, status: 500, error: "Data is corrupted" };
  }
  return { ok: true, manifest: parsed.data };
}

// 2. BEFORE shipping: run a one-off script that safeParses EVERY existing
//    record against the new schema. Failures mean fix the SCHEMA, not the data.
```

## NOTES
Use `safeParse` + a typed error result (fail soft at the boundary), not a throw mid-handler. The same hazard applies to validating API responses when the upstream service has multiple deployed versions writing slightly different shapes.
