---
tech: better-auth
tags: [session, revocation, secondary-storage, cookie-cache, sign-out, kv, redis]
severity: high
---
# Deleting session rows does not sign anyone out when secondaryStorage or cookieCache is on

## PROBLEM
A "sign out everywhere" or "remove user" feature that runs `DELETE FROM session WHERE userId = ?` looks complete: the rows are gone and a test that checks the table passes. The old cookie still works. With `secondaryStorage` configured, Better Auth keeps a copy of every session there and reads it first, never consulting the database. With `session.cookieCache` enabled, a signed cookie is trusted for its `maxAge` without reading any storage at all. So a stolen or forgotten cookie keeps opening the app, and can mint new downstream sessions or approve OAuth clients, for as long as the stored copy or cache lives.

## WRONG
```ts
// Rows deleted, test asserts the table is empty -- the session is still accepted.
await db.prepare("DELETE FROM session WHERE userId = ?").bind(userId).run();
```

## RIGHT
```ts
// 1. Clear every store Better Auth reads, through its own adapter.
const ctx = await auth.$context;
await ctx.internalAdapter.deleteUserSessions(userId);

// 2. If another service can revoke but cannot reach the secondary store, record the
//    revocation somewhere strongly consistent and check it on the READ path: a `before`
//    hook that drops the session cookie from the request when a revocation row is dated
//    at or after session.createdAt. Fail closed if the lookup throws.

// 3. Turn the cookie cache off, or accept that revocation lags by its maxAge.
session: { cookieCache: { enabled: false } }
```

## NOTES
- `internalAdapter.deleteSessions` takes session tokens; `deleteUserSessions` takes a user id (1.7.x).
- Test revocation by replaying the OLD cookie against a protected route, not by counting rows.
- Existing OAuth access and refresh tokens are a separate revocation path.
