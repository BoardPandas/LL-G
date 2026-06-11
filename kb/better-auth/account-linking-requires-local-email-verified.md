---
tech: better-auth
tags: [account-linking, accountLinking, requireLocalEmailVerified, emailVerified, trustedProviders, social-login, account_not_linked, pre-provisioned-users, magic-link]
severity: high
---
# trustedProviders does NOT bypass requireLocalEmailVerified when linking a social login

## PROBLEM
On a portal where users are pre-provisioned by an admin (no open self-signup), the FIRST time an invited user clicks "Sign in with Google/Microsoft" they get a generic `account_not_linked` error ("This account could not be linked. Please try again or use a different sign-in method."). The same user can sign in via magic link, and AFTER that Google/Microsoft works — which makes the failure look intermittent and nearly impossible to diagnose from the message alone.

The cause: Better Auth refuses to link a social account to an *existing* local user unless the local user's email is already verified. The gate in `oauth2/link-account.mjs` is:

```js
const requireLocalEmailVerified = accountLinking?.requireLocalEmailVerified ?? true; // defaults TRUE
if (
  (!isTrustedProvider && !userInfo.emailVerified) ||
  (requireLocalEmailVerified && !dbUser.user.emailVerified) ||   // <-- this clause fires
  accountLinking?.enabled === false ||
  accountLinking?.disableImplicitLinking === true
) {
  return { error: "account not linked", data: null };
}
```

The trap: listing a provider in `trustedProviders` only satisfies the FIRST clause (it waives verification of the *incoming provider's* email). It does NOT touch `requireLocalEmailVerified`, which checks the *local user row's* `emailVerified`. So if you create users with `emailVerified: false` (a common default when an admin provisions accounts), every invitee's first social sign-in is rejected even though the provider is "trusted". Magic-link / email-OTP sign-in sets `emailVerified = true` as a side effect, which is why it "fixes itself" afterward and masks the real cause.

## WRONG
```ts
// Auth config: provider is trusted, but local email verification still required (default).
betterAuth({
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['microsoft', 'google'], // does NOT bypass requireLocalEmailVerified
    },
  },
});

// Provisioning: invited users created unverified -> first social sign-in -> account_not_linked
await db.query(
  `INSERT INTO "user" (email, "emailVerified", ...) VALUES ($1, false, ...)`,
  [email],
);
```

## RIGHT
```ts
// 1) Let a trusted social login link to an unverified pre-provisioned account.
betterAuth({
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['microsoft', 'google'],
      requireLocalEmailVerified: false, // <-- the missing piece
    },
  },
});

// 2) And/or provision invited users as already verified (an admin inviting an
//    address asserts ownership, and the invite is delivered to it).
await db.query(
  `INSERT INTO "user" (email, "emailVerified", ...) VALUES ($1, true, ...)`,
  [email],
);
```

## NOTES
- Either fix alone resolves it; doing both is cleanest (config covers existing unverified rows once deployed; provisioning default covers all future invitees).
- Backfill existing affected rows: `UPDATE "user" SET "emailVerified" = true WHERE "emailVerified" = false;` — a verified local user clears the gate immediately, even before redeploying the config change.
- `requireLocalEmailVerified: false` is only safe when self-signup is effectively closed (e.g. a `databaseHooks.user.create.before` hook rejecting non-provisioned emails). With OPEN email/password signup it re-enables the classic pre-emption attack: an attacker registers an unverified password account under a victim's email, then the victim's later Google sign-in merges into the attacker's row. Keep it `true` (the default) if anyone can self-register an arbitrary email.
- The `account_not_linked` string is surfaced to the frontend as the `error=account_not_linked` callback param; map it to a friendly message but log enough to distinguish it from "unable to create user" (the error you get when a NON-provisioned email hits a blocking create hook — a different code path in the same file's register branch).
