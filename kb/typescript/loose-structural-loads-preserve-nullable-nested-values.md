---
tech: typescript
tags: [typescript, persisted-data, structural-validation, null, zod, type-assertion, batch-preflight]
severity: high
---
# Loose structural loads preserve nullable nested values

## PROBLEM
A persisted-data loader validates only an outer envelope, then returns the original
JSON object under a stronger TypeScript type so unknown legacy fields survive. That
preservation is intentional, but it also means nested Zod coercions never run. A field
typed as `string[]` can therefore still be `null` at runtime, and downstream code such
as `value.length` crashes even though typecheck is green.

This is hard to spot because fresh fixtures use the current shape, the schema appears
to normalize the field, and the crash may happen late in a large batch preflight after
many earlier records succeeded.

## WRONG
```typescript
const checked = ManifestEnvelope.safeParse(raw);
if (!checked.success) return { ok: false };

// Keeps unknown fields, but also discards every nested normalization in checked.data.
return raw as Manifest;

// The declared type says string[], while a legacy/variant record still carries null.
const label = manifest.card.colors.length
  ? manifest.card.colors.join(", ")
  : "Colorless";
```

## RIGHT
```typescript
interface SceneFace {
  colors: string[] | null;
  colorIdentity?: string[] | null;
}

function colorsForScene(face: SceneFace): string[] {
  const colors = Array.isArray(face.colors) ? face.colors : [];

  // An explicit [] means truly colorless. Only a missing/null variant value
  // falls back to the card-level identity.
  if (colors.length > 0 || Array.isArray(face.colors)) return colors;
  return Array.isArray(face.colorIdentity) ? face.colorIdentity : [];
}

const colors = colorsForScene(face);
const label = colors.length > 0 ? colors.join(", ") : "Colorless";
```

Pin the real persisted shape through the exact consumer path, not only through a
schema unit test:

```typescript
Reflect.set(persistedFace, "colors", null);
expect(buildSceneMessage(persistedFace)).toContain("Colors: G");
```

## NOTES
Do not replace a loose persisted-data boundary with a strict parse as a reflex: older
records may be rejected or undeclared keys may be stripped on a load-modify-write
round trip. Keep the compatibility envelope when it is required, but make the raw
runtime variants honest at the first consumer that depends on them and test the full
path. Related entries: `type-assertions.md`,
`zod-validation-at-persisted-data-boundary.md`, and
`unmodeled-api-variant-looks-like-corrupt-data.md`.
