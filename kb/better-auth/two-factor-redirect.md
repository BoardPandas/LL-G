---
tech: better-auth
tags: [two-factor, mfa, sign-in, redirect, silent-failure]
severity: high
---
# signIn.email two-factor response: check `twoFactorRedirect`, not `redirect`

## PROBLEM
When a user has two-factor enabled, `signIn.email` does NOT return the normal
`{ redirect, token, user }` session payload. The twoFactor plugin's `after` hook
intercepts the response and replaces it wholesale with
`{ twoFactorRedirect: true, twoFactorMethods }` — verified in better-auth
1.6.23 at `node_modules/better-auth/dist/plugins/two-factor/index.mjs:272`.

There is no `redirect` key on that response, so a `if (data?.redirect)` check is
always false and the client falls through to its success path: `router.push(callbackUrl)`
on a sign-in that was deliberately left incomplete. No session cookie was set, so
middleware bounces the user straight back to `/login` with no error and no code
prompt. Correct password, correct 2FA enrollment, silent no-op — for **every**
2FA-enabled user.

The compiler cannot catch this. The endpoint's inferred type still describes the
base `{ redirect: boolean; token: string; user: … }` shape, because the after-hook's
substitution is invisible to type inference. `data.redirect` type-checks fine and
is `undefined` at runtime; `data.twoFactorRedirect` is the key actually on the wire
and is the one TypeScript complains about. Narrow explicitly instead of trusting
the inferred type.

## WRONG
```typescript
const { data } = await authClient.signIn.email({ email, password });
if (data?.redirect) {
  router.push("/mfa-verify"); // never true — key is not on the response
}
router.push(callbackUrl); // 2FA users land here on an incomplete sign-in,
                          // have no session cookie, and get bounced to /login
```

## RIGHT
```typescript
const { data } = await authClient.signIn.email({ email, password });

// The inferred type is the base sign-in shape and does not include this key,
// so narrow rather than reading it off `data` directly.
const twoFactorRequired =
  typeof data === "object" &&
  data !== null &&
  (data as { twoFactorRedirect?: boolean }).twoFactorRedirect === true;

if (twoFactorRequired) {
  router.push("/two-factor"); // present the code prompt
  return;                     // MUST return — there is no session yet
}

router.push(callbackUrl);
```

## NOTES
- Response when 2FA is required: `{ twoFactorRedirect: true, twoFactorMethods: ("totp" | "otp")[] }`.
  Use `twoFactorMethods` to decide which prompt to render; `otp` appears whenever
  `otpOptions.sendOTP` is configured (server-level, not per-user).
- **No `token` is returned** on the 2FA branch. The pending challenge is carried by
  the signed `two_factor` cookie, which `twoFactor.verifyTotp()` /
  `verifyBackupCode()` read back. Do not try to thread a token through yourself.
- This entry previously documented `data.redirect` as the field to check. That was
  wrong for 1.6.x and shipped as a real production bug (vigilis `81ff71f2`). If you
  are auditing an older codebase, this is the first thing to check on any
  "2FA users can't sign in but there's no error" report.
- The twoFactor plugin's matcher only covers `/sign-in/{email,username,phone-number}`
  (`index.mjs:191-192`). Any other sign-in path — magic link, OAuth — bypasses the
  2FA challenge entirely. See
  [magic-link-verify-get-scanners.md](magic-link-verify-get-scanners.md).
