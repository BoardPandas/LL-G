---
tech: better-auth
tags: [two-factor, mfa, sign-in, redirect]
severity: medium
---
# signIn.email two-factor response: check `redirect`, not `twoFactorRedirect`

## PROBLEM
When two-factor authentication is enabled, `signIn.email` returns a response with a `redirect` field, not `twoFactorRedirect`. Using the wrong field name silently fails to detect the MFA challenge.

## WRONG
```typescript
const { data } = await authClient.signIn.email({ email, password });
if (data?.twoFactorRedirect) navigate("/mfa-verify"); // never triggers
```

## RIGHT
```typescript
const { data } = await authClient.signIn.email({ email, password });
if (data?.redirect) navigate("/mfa-verify");
```

## NOTES
- The response type is `{ redirect: boolean; token: string; url?: string }`
- `redirect: true` means the user needs to complete a second factor
- The `token` is used in subsequent `twoFactor.verifyTotp()` calls
