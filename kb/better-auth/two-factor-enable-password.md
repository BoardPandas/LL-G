---
tech: better-auth
tags: [two-factor, mfa, enable, password]
severity: medium
---
# twoFactor.enable requires the user's current password

## PROBLEM
Calling `twoFactor.enable()` without arguments throws a TypeScript error. The method requires the user's current password as a security verification step.

## WRONG
```typescript
const { data } = await authClient.twoFactor.enable();
// TS2554: Expected 1-2 arguments, but got 0
```

## RIGHT
```typescript
const { data } = await authClient.twoFactor.enable({ password: currentPassword });
// Returns TOTP URI and backup codes
```

## NOTES
- This is a security measure to prevent unauthorized MFA enrollment
- The password field is the user's current account password, not a new one
