---
tech: better-auth
tags: [oauth, social-login, emailVerified, session, account-linking, stale-read, handleOAuthUserInfo, mapProfileToUser]
severity: high
---
# Social sign-in promotes emailVerified in the DB but the session it mints keeps the old value

## PROBLEM

When a social sign-in supplies a verified email for a user row that already exists with
`emailVerified: false`, `handleOAuthUserInfo` promotes the row and then builds the session
from the object it read **before** that write:

```js
// better-auth/dist/oauth2/link-account.mjs (1.6.28) -- both the linked-account
// and the newly-linked branch end this way
if (userInfo.emailVerified && !dbUser.user.emailVerified && userInfo.email.toLowerCase() === dbUser.user.email)
  await c.context.internalAdapter.updateUser(dbUser.user.id, { emailVerified: true });
// `user` is still dbUser.user -- never reassigned from the update's return value
```

`updateUser` returns the updated row and the return value is discarded. The session is
created from the stale `user`, so immediately after a successful sign-in:

- the database says `emailVerified = 1`
- `auth.api.getSession()` says `emailVerified: false`

Any authorization gate reading the session refuses a user whose address was just verified
— **on exactly the sign-in they were told to make**. Nothing errors, nothing is logged, and
the two states disagree for the life of that session.

The failure is self-clearing, which is what makes it expensive to diagnose. A second
sign-in reads the now-correct row, `!dbUser.user.emailVerified` is false, no update is
needed, and the session carries `true`. So it reproduces exactly once per account, looks
intermittent, and is indistinguishable in logs from a legitimate refusal.

Most likely to bite where a provider emits no `email_verified` claim and you synthesise one
in `mapProfileToUser` (Entra via `xms_edov`, or any `genericOAuth` provider). Adding that
mapping is what first makes `userInfo.emailVerified` true for rows created while it was
false — so every pre-existing account hits the stale window on its next sign-in, and the
fix looks like it did not deploy.

## WRONG

```ts
// Gate reads the session's copy of the flag and treats it as authoritative.
const session = await auth.api.getSession({ headers: req.headers });
if (!session?.user) return redirectToSignIn();

if (session.user.emailVerified !== true) {
  // Fires on the sign-in that JUST verified this address. The row says 1.
  // Clears if the person signs in a second time, so it reads as flaky.
  log("refused", { reason: "unverified_email", userId: session.user.id });
  return refuse();
}

return issueAccess(session.user);
```

## RIGHT

```ts
const session = await auth.api.getSession({ headers: req.headers });
if (!session?.user) return redirectToSignIn();

// The session's copy can be stale for one sign-in; the row is the authority.
// Re-read only on the path that was about to refuse -- one indexed lookup,
// never on the success path.
let emailVerified = session.user.emailVerified === true;

if (!emailVerified) {
  const row = await db
    .prepare("SELECT emailVerified FROM user WHERE id = ?")
    .bind(session.user.id)
    .first<{ emailVerified: number | boolean | null }>();

  // SQLite/D1 store the boolean as an integer -- a strict `=== true` here
  // refuses every promoted row and reinstates the bug you are fixing.
  emailVerified = row?.emailVerified === 1 || row?.emailVerified === true;

  // Log when the guard fires, or the window stays invisible.
  if (emailVerified) log("session_flag_stale", { userId: session.user.id });
}

if (!emailVerified) {
  log("refused", { reason: "unverified_email", userId: session.user.id });
  return refuse();
}

return issueAccess({ ...session.user, emailVerified });
```

## NOTES

- Confirmed in **1.6.28**; the code path is unchanged back through the 1.6.x line.
- Applies to any user field promoted during sign-in, not just `emailVerified` — the
  pattern is `updateUser` called for its side effect with the return value dropped. The
  adjacent `overrideUserInfo` branch does it correctly (`user = await updateUser(...)`),
  which is a useful contrast when reading the source.
- Do **not** try to fix this by writing the flag from `mapProfileToUser` alone. That
  mapper feeds `userInfo`, which is the input to the comparison, not the session — the
  session is built from `dbUser.user` regardless of what the mapper returns. Only rows
  created fresh in that same request (`createOAuthUser`) get the value directly.
- Re-reading the row is preferable to invalidating the session and forcing a re-login: the
  latter turns one silent refusal into a redirect loop for anyone whose gate sits on the
  post-sign-in landing route.
- Secondary storage makes it stickier. With sessions cached in KV/Redis the stale user
  object is serialised into the cache, so the disagreement outlives the request that
  created it and cannot be cleared by a refresh.
- Related: [account-linking-requires-local-email-verified.md](account-linking-requires-local-email-verified.md)
  covers the *other* half of the same field — `requireLocalEmailVerified` refusing to LINK
  a social account to an `emailVerified: false` row. Set that to `false` and linking
  succeeds, which is precisely what routes you into this stale-session window.
