---
tech: typescript
tags: [as-any, discriminated-union, type-safety, refactoring, cleanup]
severity: medium
---
# Removing `as any` casts on discriminated unions: a cast that won't compile away is a real bug

## PROBLEM
A helper returns a proper discriminated union (`{ ok: true; data: T } | { ok: false; error: string }`) but every call site casts the result `as any`, usually because the casts predate the union being fully typed. The casts are now redundant and removal is mechanical. The gotcha hits during cleanup: when one site fails tsc after the cast is removed, the instinct is to re-add the cast and keep moving. That site is precisely the one hiding a genuine mismatch (a field missing from the type, or a variant accessed before narrowing). Re-casting converts a found bug back into silent wrong behavior.

## WRONG
```ts
const loaded = loadDeck(slug); // { ok: true; manifest: Manifest } | { ok: false; error: string }
if (!loaded.ok) return err(loaded.error);
const { manifest } = loaded as any; // defeats narrowing that already works

// ...during bulk cleanup, one site errors without the cast:
const { manifest } = loaded;
manifest.legacyField; // TS2339 -> "fix" by re-adding `as any`  <- the bug survives
```

## RIGHT
```ts
// Narrowing makes the cast unnecessary -- delete it:
const loaded = loadDeck(slug);
if (!loaded.ok) return err(loaded.error);
const { manifest } = loaded; // typed as the ok branch, no cast

// A site that does NOT compile after cast removal is a finding, not friction:
// - the type is missing a field that really exists -> fix the type/schema, or
// - the code reads a field that never exists -> fix the code.
// Never re-cast to silence it.
```

## NOTES
`as any` density per file tracks file size: god files erode type discipline because the types no longer fit in working memory. Treat a cast cluster as a symptom and check the file's line count. Related: [type-assertions.md](type-assertions.md).
