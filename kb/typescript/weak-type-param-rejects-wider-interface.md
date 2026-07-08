---
tech: typescript
tags: [weak-type-detection, type-guards, TS2559, interface-widening, structural-typing]
severity: medium
---
# Weak-type parameter (all-optional fields) rejects a wider interface with TS2559

## PROBLEM
A function whose parameter type has every field optional (a "weak type", e.g.
`{ officialPrecon?: boolean; gauntletDeck?: boolean }`) triggers TypeScript's
weak-type detection: if the argument's type has ZERO property names in common
with the parameter type, tsc rejects the call with TS2559 ("has no properties
in common with type ..."), even though the argument's real shape is compatible
at runtime and the fields genuinely exist on it. This bites hardest when the
function already has other call sites that work fine -- those sites usually
pass an untyped `JSON.parse(...)` result (typed `any`, so weak-type detection
never engages) or an object literal that happens to declare a matching field,
while a NEW call site typed against a stricter, wider interface (e.g. a full
manifest type with 30+ other fields, but not these two) fails.

## WRONG
```typescript
// scope.ts
export function isReferenceDeck(
  resource: { officialPrecon?: boolean; gauntletDeck?: boolean } | null | undefined,
): boolean { ... }

// deck-color-stats.ts
import type { ProxyDeckManifest } from "proxy-pipeline/types/manifest.js";

let manifest: ProxyDeckManifest;
manifest = loadManifestFromDisk(manifestPath);
if (isReferenceDeck(manifest)) continue;
// TS2559: Type 'ProxyDeckManifest' has no properties in common with type
// '{ officialPrecon?: boolean | undefined; gauntletDeck?: boolean | undefined; }'.
// (ProxyDeckManifest is a large, strict interface that never declares these
// two fields explicitly, even though they exist at runtime on real manifests.)
```

## RIGHT
```typescript
// scope.ts already exports a wider interface used elsewhere for the same ACL
// shape -- both fields declared optional there too:
export interface OwnedResource {
  owner: Owner;
  share?: Share;
  visibility?: string;
  officialPrecon?: boolean;
  gauntletDeck?: boolean;
}

// deck-color-stats.ts
import { isReferenceDeck, userRole, type OwnedResource } from "./scope.js";

let manifest: ProxyDeckManifest;
manifest = loadManifestFromDisk(manifestPath);
// Widen through the already-declared compatible interface first -- this is a
// real assignability check (manifest's owner/share/visibility DO satisfy
// OwnedResource), not a cast, so it still catches a genuine shape mismatch.
const resource: OwnedResource = manifest;
if (isReferenceDeck(resource)) continue;
if (userRole(resource, user) !== "owner") continue;
```

## NOTES
- Do NOT reach for `as` to silence TS2559 here -- that suppresses the real
  assignability check entirely. Widening through an intermediate `const x: Wider = value`
  still type-checks the assignment; it only sidesteps the weak-type heuristic,
  which is specifically about the CALL SITE's inferred narrow-vs-wide typing,
  not the underlying structural compatibility.
- Before introducing a NEW intermediate interface, grep the target function's
  own module for an existing interface that already declares the same optional
  fields (often the function's sibling helpers already use one, e.g. other
  ACL/role functions in the same file take the same wider shape). Reuse it
  rather than inventing a parallel one -- that's what made this fix a one-line
  `const resource: OwnedResource = manifest;` instead of a new type.
- Also do NOT widen the callee's OWN parameter type to fix this -- other
  callers may rely on it staying narrow/weak (that's often intentional, so
  a stray object literal with a typo'd field name still gets caught).
- Root cause reading: TS's weak-type check (all-optional object types) exists
  to catch typos like `{ officialPrecons: true }` on an object literal. It's a
  structural heuristic, not a subtype check, so it can false-positive when a
  much wider *nominal-feeling* interface is passed directly instead of a
  literal or an `any`.
