---
tech: better-auth
tags: [auth.api, set-cookie, session, signup, nextCookies, returnHeaders, next.js, silent-failure]
severity: high
---
# Server-side auth.api.* calls silently drop Set-Cookie

## PROBLEM

`auth.api.signUpEmail(...)` — and every other `auth.api.*` endpoint that mints a
session — writes the session cookie into Better Auth's **internal** response
headers. A direct `auth.api.*` call returns only the parsed body, so those
headers are discarded on the floor.

Passing `req.headers` into the call does NOT make the cookie reach the browser.
That is the trap: `headers` is an *input* (it carries the incoming cookies/IP for
the endpoint to read), not a two-way channel, but the code reads as if it wires
the request and response together. It passes code review.

Nothing errors. The user row, the membership row, and the `session` row are all
created correctly, and every log line looks like a success — the response simply
has no `Set-Cookie`. Users then report symptoms that sound like anything except a
missing cookie:

- "It logged me in as a generic user with no permissions" — the client navigates
  to an authenticated page which renders its shell with no session behind it.
- "I refreshed and I was logged out" — middleware finds no session cookie and
  bounces to `/login`.
- "I accepted the invite and it just put me back in my own account" — an admin
  accepting an invite in a signed-in window keeps their existing cookie, so the
  new account is created and then invisibly discarded.

Because the DB state is perfect, the obvious places to look (the invite record,
the membership, the session table) all check out, which sends you hunting in
middleware and org-resolution logic instead.

## WRONG

```ts
// The account is created. The session row exists. No cookie ever reaches the browser.
const result = await auth.api.signUpEmail({
  headers: req.headers, // input only — does NOT plumb the response back out
  body: { email, name, password },
});
const userId = (result as { user?: { id: string } }).user?.id;

return NextResponse.json({ data: { redirectTo: "/dashboard" } });
// -> client router.push("/dashboard") -> middleware sees no cookie -> /login
```

## RIGHT

```ts
// `returnHeaders: true` yields { headers, response }; forward the cookies yourself.
const { headers, response } = await auth.api.signUpEmail({
  headers: req.headers,
  body: { email, name, password },
  returnHeaders: true,
});
const userId = (response as { user?: { id: string } })?.user?.id;

const res = NextResponse.json({ data: { redirectTo: "/dashboard" } });
// getSetCookie() — NOT get("set-cookie"), which collapses multiple cookies
// into one malformed header.
for (const cookie of headers?.getSetCookie() ?? []) {
  res.headers.append("set-cookie", cookie);
}
res.headers.set("Cache-Control", "no-store"); // it now carries a credential
return res;
```

## NOTES

- **Prefer `returnHeaders: true` over `asResponse: true`.** With `returnHeaders`
  Better Auth still **throws** `APIError`, so existing `try/catch` handling keeps
  working — including a `databaseHooks.user.create.before` that throws FORBIDDEN
  to enforce invite-only signup, whose message you want to surface verbatim.
  `asResponse` folds errors into a non-ok `Response` you must re-parse, quietly
  changing your error contract.
- **The framework-wide alternative is the `nextCookies()` plugin** from
  `better-auth/next-js`, registered **last** in the plugin array. Its `after` hook
  copies `ctx.context.responseHeaders` into `next/headers` `cookies()`. It fixes
  every call site at once, but it rewrites cookies for *every* `auth.api` call in
  the app — including `getSession` reads inside RSC renders — so on a large or
  security-sensitive auth surface the targeted `returnHeaders` fix has a far
  smaller blast radius. Pick deliberately; do not assume the plugin is installed.
- **Every return path after account creation needs the forward**, not just the
  happy one. Routes that branch into a Stripe Checkout redirect, or fall back to a
  "resume billing" URL when checkout fails, each return their own response — miss
  one and that branch alone strands the user signed out.
- **Audit every `auth.api.*` call that mints a session**, not just signup:
  `signInEmail`, `verifyTwoFactor`, `magicLinkVerify`, `verifyOneTimeToken`. The
  same drop applies to all of them.
- If your app records *how* a session was authenticated (an `authMethod` column
  stamped in `databaseHooks.session.create.before` from `ctx.path`), remember that
  fixing this makes `/sign-up/email` a genuinely session-minting path for the first
  time. Classify it, or it stores NULL and whatever your "unknown method" fallback
  is will apply to every brand-new account.
- Verified on better-auth 1.6.23. See also
  [Cross-subdomain cookies require explicit config](cross-subdomain-cookies.md).
