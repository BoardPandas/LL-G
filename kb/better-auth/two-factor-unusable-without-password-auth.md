---
tech: better-auth
tags: [two-factor, totp, passkey, webauthn, step-up, magic-link, social-login, passwordless, mfa]
severity: high
---
# twoFactor() is unusable for step-up when the deployment has no password auth

## PROBLEM

`twoFactor.enable()` requires the user's **current password**, and the plugin offers
no other way to enroll. In a deployment whose only sign-in methods are magic link
and social providers, no user has ever had a password — so there is nothing to pass,
and **every** staff member fails at enrolment.

Nothing warns you. The plugin imports, `betterAuth({ plugins: [twoFactor()] })`
configures, the tables migrate, and the TypeScript compiles. The failure surfaces
per-user at the enrolment call, which is usually the last thing built and the point
where the cost of switching approach is highest.

This bites hardest when 2FA is being added as **step-up authentication** (re-proving
identity before a destructive action) rather than as a login factor. Step-up is
exactly the feature a password-less deployment wants — its whole premise is that the
session alone is not enough — and it is the one the plugin cannot serve.

The related trap: `better-auth` ships **no passkey plugin** in the package. Checking
`node_modules/better-auth/dist/plugins/` shows `two-factor`, `email-otp`,
`magic-link`, `phone-number` and others, but nothing for WebAuthn. A
`from 'better-auth/plugins/passkey'` import simply does not resolve, so "just use
passkeys instead" is not a one-line pivot either.

Check for a password path **before** designing around the plugin:

```bash
grep -n "emailAndPassword" src/lib/auth.ts
ls node_modules/better-auth/dist/plugins/ | grep -i passkey
```

No `emailAndPassword` block and no passkey directory means both plugin routes are
closed, and the factor has to be implemented against your own tables.

## WRONG

```ts
// auth.ts — magic link + social only. No emailAndPassword anywhere.
export const auth = betterAuth({
  plugins: [
    magicLink({ sendMagicLink }),
    twoFactor(),          // configures fine, migrates fine, compiles fine
  ],
  socialProviders: { google: {...}, microsoft: {...} },
})

// The step-up flow, which cannot work for anyone:
await authClient.twoFactor.enable({ password })
//                                  ^^^^^^^^
// There is no password. The user signed in with a magic link.
// Prompting for one asks for a credential that was never set.

// And the pivot that looks obvious is not available:
import { passkey } from 'better-auth/plugins/passkey'  // does not resolve
```

## RIGHT

```ts
// Own the factor. Credentials live in your tables, keyed to the user, and the
// ceremony is driven directly rather than through a plugin.
//
//   pnpm add @simplewebauthn/server      # API
//   pnpm add @simplewebauthn/browser     # client

import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'

// Enrolment needs no pre-existing credential — that is the whole point.
const options = await generateAuthenticationOptions({
  rpID: 'example.com',                    // registrable domain, no leading dot
  allowCredentials: registered.map((c) => ({ id: c.credentialId })),
  userVerification: 'required',
})

const verification = await verifyAuthenticationResponse({
  response,
  expectedChallenge: challenge,           // single-use, claimed in one UPDATE
  expectedOrigin: allowedOrigins,
  expectedRPID: 'example.com',
  requireUserVerification: true,
  credential: { id, publicKey, counter, transports },
})

// A counter that has not advanced means two things answer for one credential.
if (previousCounter > 0 && verification.authenticationInfo.newCounter <= previousCounter) {
  await revokeCredential(id)              // treat as cloned, not as a retry
}
```

If WebAuthn is not viable (no browser context, kiosk hardware), RFC 6238 TOTP is
~150 lines against `crypto.createHmac('sha1', ...)` with the secret encrypted at
rest — still less work than retrofitting password auth onto a password-less tenant
purely to satisfy `twoFactor.enable`.

## NOTES

- Related: [twoFactor.enable requires the user's current password](two-factor-enable-password.md)
  documents the `TS2554` from calling it with no arguments. This entry is the
  consequence one layer up — when there is no password to supply at all, the
  argument cannot be satisfied and the plugin is structurally unusable rather than
  merely mis-called.
- Also related: [Minor better-auth upgrades silently add REQUIRED plugin columns](plugin-schema-drift-on-upgrade.md).
  Owning the tables sidesteps that class of breakage entirely, which is a real
  secondary benefit for a security-critical path.
- `email-otp` **is** bundled and needs no password, so it is the one plugin-supplied
  factor available here. It is a weak step-up though: a code mailed to the address
  that already receives the magic link adds no independent factor — anyone holding
  the mailbox holds both. Fine for enrolment recovery, not for authorizing
  destructive actions.
- Verified against `better-auth@1.6.18`.
