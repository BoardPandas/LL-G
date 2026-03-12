---
tech: typescript
tags: [optional-chaining, nullish-coalescing, undefined, null, falsy]
severity: medium
---
# Optional chaining vs nullish coalescing

## PROBLEM
`?.` (optional chaining) and `??` (nullish coalescing) only protect against `null` and `undefined`. They do NOT treat other falsy values (`0`, `""`, `false`, `NaN`) as "missing." Using `??` as a general falsy-value fallback, or expecting `?.` to handle all falsy cases, silently produces wrong output.

## WRONG
```ts
// ?? treats 0 and "" as valid values -- not as "missing"
const count = userInput ?? 10
// If userInput is 0, count is 0 (correct)
// If userInput is '', count is '' (probably wrong -- empty string treated as valid)

// Expecting ?? to handle empty string as "no value"
const name = user.name ?? 'Anonymous'
// If user.name is '', name is '' -- NOT 'Anonymous'

// Mixing up || and ?? intent
const port = config.port || 3000  // 0 becomes 3000 (probably wrong -- 0 is a valid port)
const port = config.port ?? 3000  // 0 stays 0 (correct)
```

## RIGHT
```ts
// ?? for null/undefined only
const count = value ?? defaultCount   // 0 and '' pass through as-is

// || for any falsy value (when 0, '', false are also "no value")
const label = text || 'Untitled'      // '', null, undefined, 0, false all fall back

// Explicit check when intent is ambiguous
const name = (user.name && user.name.trim()) ? user.name.trim() : 'Anonymous'

// Optional chaining for potentially-null objects
const city = user?.address?.city     // undefined if any part is null/undefined
const upper = user?.name?.toUpperCase()  // undefined if user or name is null/undefined
```

## NOTES
- Use `??` when `0`, `false`, and `""` are valid values that should pass through
- Use `||` when any falsy value means "not set" -- but be explicit about the intent in a comment
- `?.` short-circuits the entire chain and returns `undefined` -- it never throws on null/undefined access
- `?.` and `??` are often combined: `user?.name ?? 'Anonymous'` -- safe access with a null/undefined fallback
- TypeScript's strict null checks (`"strictNullChecks": true`) catch many of these at compile time if your types are accurate
