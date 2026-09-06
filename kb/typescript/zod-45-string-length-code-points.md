---
tech: typescript
tags: [zod, dependencies, unicode, validation, go, contracts]
severity: high
---
# Zod 4.5 changes string bounds from UTF-16 units to code points

## PROBLEM
Zod 4.5 changes string `.min()`, `.max()`, and `.length()` to count Unicode code points. Earlier Zod 4 releases counted JavaScript UTF-16 code units. A routine minor update therefore changes which payloads a schema accepts without any type error. A Go validator deliberately mirroring the old UTF-16 contract then disagrees with the server.

In SupportForge, 300 emoji occupy 600 UTF-16 units. A summary capped at 500 was rejected by Zod 4.4.3 and the Go v1 validator, but accepted by Zod 4.5.4. Both the API build and typechecks passed; shared invalid-input fixtures caught the regression.

## WRONG
```ts
// Assuming the installed library still measures the published v1 bound in UTF-16.
const summary = z.string().min(1).max(500);
summary.parse('\u{1F600}'.repeat(300)); // Starts succeeding in Zod 4.5.
```

## RIGHT
For an upgrade that cannot include a coordinated wire-contract migration, pin the last validated release exactly in every direct manifest and regenerate the lockfile:
```json
"zod": "4.4.3"
```

To upgrade later, explicitly preserve the existing unit at every affected bound or version and migrate both validators together. For example, an explicit UTF-16 maximum can be expressed with a refinement on `value.length`; preserving error categories may require a custom `too_big` issue instead of the default refinement error. Audit minimum and exact-length checks too, not just maximum bounds.

Keep shared valid/invalid fixtures for ASCII, BMP characters, astral characters, exact boundaries, and one unit over. Do not change an invalid fixture to valid just to make the upgrade pass.

## NOTES
- A caret such as `^4.4.3` allows the incompatible minor during a later lockfile refresh; it is not a holdback.
- This applies to Zod 4 string checks, not array bounds. Zod 3 has separate behavior.
- Official change: https://zod.dev/blog/zod-4-5#%EF%B8%8F-string-length-counts-code-points
- Observed 2026-09-06, Zod 4.4.3 to 4.5.4. The exact pin is a temporary compatibility choice, not a permanent version recommendation.
