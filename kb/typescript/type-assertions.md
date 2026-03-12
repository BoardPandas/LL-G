---
tech: typescript
tags: [type-assertions, as, type-guards, satisfies, instanceof]
severity: high
---
# Type assertions with as

## PROBLEM
`as` is a compile-time-only assertion that tells TypeScript "trust me, I know the type." It bypasses all type checking unconditionally -- TypeScript does not verify the assertion at runtime or compile time. Incorrect `as` assertions cause runtime crashes that TypeScript was supposed to prevent.

## WRONG
```ts
// Casting unknown API response -- no validation, crashes at runtime if shape is wrong
const user = await fetchUser() as User
console.log(user.email.toUpperCase())  // runtime crash if email is undefined

// Casting to get past a type error instead of fixing the root cause
const el = document.getElementById('myForm') as HTMLFormElement
el.submit()  // crashes if the element doesn't exist or isn't a form
```

## RIGHT
```ts
// Type guard -- validates at runtime, narrows the type safely
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as any).email === 'string'
  )
}

const raw = await fetchUser()
if (isUser(raw)) {
  console.log(raw.email.toUpperCase())  // safe -- type is narrowed
}

// satisfies -- validates against a type at compile time without widening
const config = {
  port: 3000,
  host: 'localhost',
} satisfies ServerConfig  // error here if shape is wrong

// instanceof -- safe for class instances
const el = document.getElementById('myForm')
if (el instanceof HTMLFormElement) {
  el.submit()  // safe
}
```

## NOTES
- `as` is sometimes unavoidable (e.g., `as unknown as TargetType` for genuine type system limitations) -- document why when used
- Zod, Valibot, or similar schema validators are the right tool for validating external data (API responses, form input, JSON files)
- `satisfies` (TypeScript 4.9+) is the right replacement for `as` when you want to check conformance without changing the inferred type
