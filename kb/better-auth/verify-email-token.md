---
tech: better-auth
tags: [verify-email, token, query-params, GET-endpoint]
severity: high
---
# verifyEmail token goes in query param, not top-level body

## PROBLEM
`verifyEmail` is a GET endpoint. GET endpoints pass parameters in the `query` object, not at the top level of the options. Passing `token` at the top level causes a TypeScript error (property not in type) and the token is never sent.

## WRONG
```typescript
// TypeScript error: Argument of type '{ token: string }' is not assignable
await authClient.verifyEmail({ token })
```

## RIGHT
```typescript
// GET endpoints use the query property
await authClient.verifyEmail({ query: { token } })
```

## NOTES
- General rule: GET endpoints use `query: { ... }`, POST endpoints use top-level properties.
- To determine which is which, check the route definition or the TypeScript types in `dist/api/routes/`.
- This pattern also applies to other GET endpoints like `resetPassword` if it accepts a token via URL params.
