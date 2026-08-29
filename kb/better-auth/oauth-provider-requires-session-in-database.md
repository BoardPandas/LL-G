---
tech: better-auth
tags: [better-auth, oauth-provider, secondaryStorage, sessions, redis, boot-failure, mcp]
severity: high
---
# oauth-provider refuses to construct on secondaryStorage alone, and existing sessions break after you fix it

## PROBLEM

Adding `@better-auth/oauth-provider` to an instance that stores sessions in
`secondaryStorage` (Redis) throws at construction:

```
BetterAuthError: OAuth Provider requires `session.storeSessionInDatabase: true` when using secondaryStorage
```

It throws from `betterAuth(...)` itself, so the process **crash-loops on deploy**. Every request
fails, including magic-link sign-in, which answers 500 with no clue that OAuth is involved. It is
only found at boot — no type error, no lint.

The demand is legitimate: every access token the provider mints carries the originating session's
id as a `sid` claim, and a resource server resolves that back to a session **row**. With sessions in
Redis only there is no row to read.

**The second half is the one that bites after the fix.** Turning on `storeSessionInDatabase` only
affects sessions minted *from then on*. Every session already live exists in Redis with no database
row, and the organization plugin's `setActive` does:

```ts
await setSessionCookie(ctx, {
  session: await adapter.setActiveOrganization(session.session.token, organization.id, ctx),
  user: session.user,
});
```

`setActiveOrganization` updates the session **row** by token and returns it — `null` when there is
no row — and `setSessionCookie` then dereferences `.token` on `null`:

```
TypeError: Cannot read properties of null (reading 'token')
    at setSessionCookie (better-auth/dist/cookies/index.mjs)
    at .../plugins/organization/routes/crud-org.mjs
```

If your SPA asserts the active organization on mount (a common pattern) and swallows the error, this
is a **500 on every page load for every pre-existing session**, logged and otherwise invisible.
Those users also cannot complete an OAuth flow, because the token's `sid` resolves to nothing.

## WRONG

```ts
export const auth = betterAuth({
  secondaryStorage: redisSecondaryStorage(redis),   // sessions in Redis only
  plugins: [
    jwt(),
    oauthProvider({ loginPage: '/sign-in', consentPage: '/consent', ... }),
  ],
});
// throws at construction -> API crash-loops on deploy
```

## RIGHT

```ts
export const auth = betterAuth({
  secondaryStorage: redisSecondaryStorage(redis),

  // Redis stays the read path for ordinary requests; this writes a durable copy
  // beside it. The cost is one INSERT per sign-in and a row per live session.
  session: { storeSessionInDatabase: true },

  plugins: [
    jwt(),
    oauthProvider({ loginPage: `${webOrigin}/sign-in`, consentPage: `${webOrigin}/consent`, ... }),
  ],
});
```

## NOTES

- **Plan for the migration of live sessions.** After enabling it, sessions minted earlier still have
  no row. Either accept a window where `setActive` 500s until they expire, or invalidate the session
  store once so everyone re-authenticates into a database-backed session. A single sign-out/sign-in
  fixes an individual user immediately, which is also how to confirm the diagnosis cheaply.
- **This is caught by any test that constructs the auth instance**, because it throws from
  `betterAuth(...)`. A test harness using a memory adapter must also declare the plugin's tables
  (`jwks`, `oauthClient`, `oauthResource`, `oauthClientResource`, `oauthAccessToken`,
  `oauthRefreshToken`, `oauthConsent`) — the adapter cannot create what it was not given, and an
  absent array surfaces as a 500 on unrelated endpoints.
- `loginPage` / `consentPage` must be **absolute** when the SPA is on a different host from the API.
  The provider redirects with `Location: <page>?<signed params>`, and a relative path resolves
  against the origin that sent the redirect — the API — producing a 404 on the API host at the exact
  moment somebody was about to approve.
- Related: `oauth-provider-1-7-validaudiences-ignored.md`,
  `oauth-provider-resource-verification.md`, `oauth-provider-strict-client-discovery.md`.
