---
tech: better-auth
tags: [oauth, social-login, magic-link, invitations, roles, authorization, callback, side-effects]
severity: high
---
# A role/grant side-effect wired to one sign-in route silently skips every social callback

## PROBLEM
Better Auth answers the social OAuth callback itself, at `/api/auth/callback/:provider`,
inside the `auth.handler(...)` catch-all. There is no hand-written route for it, so there
is nowhere obvious to hang "and now apply their pending invitation".

Magic link is different: you usually DO own that route, because the emailed link has to
land on an inert interstitial that POSTs the token (see
`magic-link-verify-get-scanners.md`). So the side-effect gets written where there is a
convenient seam -- in the magic-link confirm handler -- and it looks complete, because
the flow it was written for works end to end.

It is not complete. It fires on exactly one of the three ways in. Anyone who presses
"Continue with Google" or "Continue with Microsoft" gets a real session, a real user row,
and **no role**. Every symptom points away from the cause:

- No error, anywhere. The sign-in succeeded; the callback returned 302 and the person is
  authenticated. Nothing throws, nothing is logged, no test fails.
- They land on whatever your "you are not authorized" page says -- which tells them, in
  effect, that they were never invited. They were.
- The admin screen contradicts them. The invitation is still listed as pending, and once
  an admin promotes them by hand the account reads as fully authorized while the person
  is still looking at the refusal. The two screenshots disagree and both are current.
- The invitation is never consumed, so it sits open until an expiry sweep removes it days
  later, with no record that anyone tried to use it.

The provider mix decides who trips it. At a Microsoft or Google shop the social button IS
the obvious action -- the invited address is already a work account -- so the emailed link
is the path fewer people take, and the bug hits most invitees rather than an edge case.

A session-creation hook (`databaseHooks.session.create.after`) closes the provider gap but
opens a second one: it only fires when a session is minted. Someone who already holds a
live session when they are invited is not upgraded until that session ends. With 30-day
sessions extended on activity, "next time they sign in" can mean next month.

## WRONG
```ts
// The ONLY place a pending invitation becomes a role -- or so the comment says.
app.post("/signin/confirm", async (c) => {
  const { headers, response } = await auth.api.magicLinkVerify({
    query: { token },
    headers: c.req.raw.headers,
    returnHeaders: true,
  });

  const user = (response as { user?: { id: string; email: string } })?.user;
  if (user) await applyPendingInvitation(db, user.id, user.email);

  return redirect(next, headers);
});

// Meanwhile: /api/auth/* is handed straight to Better Auth, and
// /api/auth/callback/google and /api/auth/callback/microsoft are answered in there.
// Nothing applies an invitation on either one.
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

// The gate that then refuses them, reading a role nothing ever set:
const role = await getRole(env, session.user.id);   // null
if (!hasPanelAccess(role)) return forbidden();      // "you are not an operator"
```

## RIGHT
```ts
// Resolve it where the role is READ, not where a session is created. Every gate already
// calls this, so it covers all three providers at once -- including any added later, and
// including a session that predates the invitation.
export async function getRole(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT email, role, emailVerified FROM user WHERE id = ? LIMIT 1",
  ).bind(userId).first<{ email: string | null; role: string | null; emailVerified: number | boolean | null }>();

  if (!row) return null;
  const role = row.role ?? null;

  // Already privileged -- an invitation cannot add anything, so do not go looking.
  if (hasPanelAccess(role)) return role;

  // The address must be PROVEN, and the row is the authority, not the session:
  // a social sign-in promotes the row before the session it mints reflects it
  // (see social-signin-emailverified-stale-session.md). Match the integer form too.
  const verified = row.emailVerified === true || row.emailVerified === 1;
  if (!verified || !row.email) return role;

  try {
    const applied = await applyPendingInvitation(db, userId, row.email);
    if (applied.applied) return applied.role ?? role;
  } catch (e) {
    // Never fail the request over this. They are legitimately signed in either way and
    // the invitation stays open for the next one; throwing turns a bookkeeping error
    // into a lockout on the exact screen they were invited to use.
    console.error("invitation_apply_failed", { name: e instanceof Error ? e.name : "unknown" });
  }

  return role;
}
```

## NOTES
The general shape: **any side-effect that must happen "when someone signs in" needs a seam
common to every provider.** Ranked by how much they actually cover:

1. **At the read** (`getRole`, `requireX`, session-resolution middleware) -- covers every
   provider AND sessions that predate the event. Costs one extra query only on the
   unprivileged path, which short-circuits away as soon as the role lands. The trade is
   that a function named like a getter performs a privileged write; make the write
   idempotent, single-use and race-safe, and say so at the call site.
2. **`databaseHooks.session.create.after`** -- covers every provider, misses live
   sessions. Note these are database hooks, not plugin middleware, so the
   "must return an object" rule in `after-hook-must-return-object.md` does NOT apply here;
   returning void is correct.
3. **One sign-in route** -- covers one provider. This bug.

Keep the verification gate wherever you move it. An invitation is keyed on an email
address, so applying one for an address nobody has proven control of hands privilege to
whoever asserted it. Magic link proves it by construction, Google sets `emailVerified`
from `email_verified`, and Entra has no such claim at all -- if you synthesise it from
`xms_edov`, read the row rather than the session or you will refuse the user on the very
sign-in that verified them (`social-signin-emailverified-stale-session.md`).

Worth auditing alongside this: welcome emails, first-login analytics, tenant
provisioning, seat counting, audit rows for "account activated". Anything written into a
magic-link or password handler has the same hole, and all of them fail silently for the
same reason -- the social path succeeded, so nothing anywhere reports a problem.

Also audit the reverse direction: if an invitation can carry a role that is equivalent to
the default (a "viewer" invitation where unassigned already means viewer), it grants
nothing while rendering as a pending gate, which makes this bug considerably harder to
see on the admin screen.
