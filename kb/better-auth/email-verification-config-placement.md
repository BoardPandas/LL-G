---
tech: better-auth
tags: [email-verification, sendVerificationEmail, emailAndPassword, emailVerification, sendOnSignUp, signUpEmail, silent-failure, resend]
severity: high
---
# sendVerificationEmail inside emailAndPassword is silently ignored

## PROBLEM
Placing the `sendVerificationEmail` callback inside the `emailAndPassword` config object
disables verification email entirely — with no type error and no runtime warning. Better
Auth only reads that callback from the **top-level `emailVerification`** config block; an
unknown key inside `emailAndPassword` is simply ignored. `requireEmailVerification: true`
still blocks unverified sign-ins, so users are created, told to check their inbox, and no
email is ever sent (nothing even reaches the provider — an empty Resend/SES log is the tell).

This can hide for months: flows that mark mailboxes verified manually (invite-token accepts,
magic-link provisioning) never exercise the send path. The first genuine public
email/password signup hits it in production (Vigilis, 2026-07-15, fixed in `3a91cf08`).

## WRONG
```typescript
export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    // Silently ignored — emailAndPassword has no such option.
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({ to: user.email, subject: "Verify your account", html: `<a href="${url}">Verify</a>` });
    },
    sendResetPassword: async ({ user, url }) => { /* this one IS a valid emailAndPassword option */ },
  },
});
```

## RIGHT
```typescript
export const auth = betterAuth({
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => { /* correct here */ },
  },
  // Top-level block — the only place Better Auth reads the verification sender.
  emailVerification: {
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url, token }, request) => {
      await sendEmail({ to: user.email, subject: "Verify your account", html: `<a href="${url}">Verify</a>` });
    },
  },
});
```

## NOTES
- Related trap: `emailVerification.sendOnSignUp: true` fires for EVERY `auth.api.signUpEmail`
  call — including invite-accept flows that immediately set `emailVerified = true` themselves,
  which would spam already-proven invitees with pointless "verify your account" mail. If some
  signups are mailbox-proven by an invite token, leave `sendOnSignUp` off and trigger the send
  explicitly from the flows that need it:
  `auth.api.sendVerificationEmail({ headers, body: { email, callbackURL: "/login" } })`.
- Once the top-level sender exists, an unverified sign-in attempt under
  `requireEmailVerification: true` automatically (re)sends the verification email — that is
  the self-serve recovery path for users stranded by this bug.
- The callback signature is `({ user, url, token }, request)` — `request` carries the original
  Request when available (useful for host-based email branding).
