---
tech: typescript
tags: [type-guard, narrowing, predicate, never, undefined]
severity: medium
---
# A type predicate narrows its FALSE branch too, so an extra condition makes the else branch `never`

## PROBLEM
`(s: T | undefined): s is T` tells TypeScript that `false` means "not T". If the guard
also checks something else (`s.status !== 'unavailable'`), a T that fails only that
check still lands in the else branch, typed as `undefined`. Property access there
errors with "Property 'label' does not exist on type 'never'", even though the value
is a real T at runtime.

## WRONG
```ts
const isReadable = (s: Section | undefined): s is Section =>
  s != null && s.status !== 'restricted' && s.status !== 'unavailable'
if (!isReadable(section)) return section.label // TS2339: 'label' on never
```

## RIGHT
```ts
type ReadableSection = Section & { status: 'available' | 'partial' | 'no_data' }
const isReadable = (s: Section | undefined): s is ReadableSection =>
  s != null && s.status !== 'restricted' && s.status !== 'unavailable'
if (!isReadable(section)) return section?.label // Section | undefined, as it should be
```

## NOTES
Predicate the exact refinement the check proves. A type that only drops `undefined` is
too broad. See also type-predicate-assignability.
