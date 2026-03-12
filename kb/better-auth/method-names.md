---
tech: better-auth
tags: [method-names, camelCase, client-api, type-definitions, dist]
severity: medium
---
# Method names are camelCase from URL paths -- check types

## PROBLEM
Better Auth client method names are derived by camelCasing the URL path segments. Documentation examples and guesswork are unreliable. Using the wrong method name causes TypeScript errors and the operation fails silently or throws.

## WRONG
```typescript
authClient.forgetPassword({ email })          // doesn't exist
authClient.twoFactor.verifyTOTP({ code })     // wrong casing (TOTP not Totp)
authClient.requestPasswordReset({ email })    // possibly correct but verify
```

## RIGHT
```typescript
// Check actual method names from TypeScript types
authClient.requestPasswordReset({ email, redirectTo })
authClient.twoFactor.verifyTotp({ code })     // camelCase of /two-factor/verify-totp

// General pattern: /request-password-reset -> requestPasswordReset
//                  /two-factor/verify-totp  -> twoFactor.verifyTotp
```

## NOTES
- When unsure, check `node_modules/better-auth/dist/api/routes/*.d.mts` for endpoint names, then convert to camelCase.
- The `twoFactor.enable()` method requires a `password` property -- it will throw a TypeScript error if called without it.
- Method signatures change between Better Auth versions. Always check types against the installed version, not documentation.
