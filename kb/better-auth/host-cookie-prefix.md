---
tech: better-auth
tags: [cookies, session, security, host-prefix, subdomain, cookie-shadowing, oauth, csrf]
severity: high
---
# `__Host-` cookies require `useSecureCookies: false`, which is not the downgrade it looks like

## PROBLEM

Better Auth has no option for emitting `__Host-`-prefixed cookies, and the one that looks
like it would help does the opposite of what its name suggests.

This matters whenever the app shares a registrable domain with anything else — a marketing
site, a helpdesk, a vendor SaaS on a sibling subdomain. Cookies are not origin-scoped, so
any of those hosts can set `Domain=example.com` and the browser will send it to your app
too. That is **cookie shadowing**, the setup for session fixation and for forcing a chosen
`state`/PKCE value into an OAuth flow.

`__Secure-` does **not** prevent this. It asserts only that the cookie was set over HTTPS.
A sibling can still set a `Domain`-scoped cookie of the same name. Only `__Host-` helps: a
browser refuses the cookie unless it is `Secure`, `Path=/`, and carries **no `Domain`
attribute**, so a sibling cannot set that name at all.

Three things make this hard to discover (verified against `better-auth@1.6.27`):

1. The package **defines and exports `HOST_COOKIE_PREFIX = "__Host-"`**
   (`dist/cookies/cookie-utils.mjs:11`) but **never references it in any code path**. It
   looks supported. It is not.
2. `advanced.useSecureCookies` is read at exactly **one** site in the entire package
   (`dist/cookies/index.mjs:21`) and does exactly one thing: choose `"__Secure-"` or `""`
   as a string prepended to the cookie **name**. It does *not* gate the `Secure`
   attribute — that comes from `secure: !!secureCookiePrefix`, which
   `defaultCookieAttributes` then overrides.
3. The final name is `` `${secureCookiePrefix}${cookiePrefix}.${cookieName}` ``. So
   `cookiePrefix` can only reach **position 0** — the only position a browser reads a
   prefix from — when `secureCookiePrefix` is empty.

The failure mode is silent in both directions. Set `useSecureCookies: true` and you get a
shadowable `__Secure-` cookie that works perfectly in every test. Set `Domain` anywhere
near a `__Host-` cookie and the browser drops it outright, which presents as "sign-in does
nothing" with no error.

## WRONG

```ts
// Looks correct, IS shadowable. Emits `__Secure-better-auth.session_token`, which a
// sibling subdomain can shadow with a `Domain=`-scoped cookie of the same name.
betterAuth({
  advanced: {
    useSecureCookies: true,
    defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax", path: "/" },
  },
});

// Also wrong — `__Secure-` is prepended in FRONT of your prefix, so the browser reads
// `__Secure-` and the `__Host-` becomes meaningless text in the middle of the name:
//   __Secure-__Host-myapp.session_token
betterAuth({
  advanced: { useSecureCookies: true, cookiePrefix: "__Host-myapp" },
});
```

## RIGHT

```ts
betterAuth({
  advanced: {
    // NOT a downgrade. This flag only selects the NAME prefix; the `Secure` attribute
    // comes from defaultCookieAttributes below. Turning it off frees position 0 of the
    // name so `cookiePrefix` can put `__Host-` there.
    useSecureCookies: false,
    cookiePrefix: "__Host-myapp",

    // `__Host-` REQUIRES all of: Secure, Path=/, and no Domain. Miss one and the browser
    // silently refuses to store the cookie.
    defaultCookieAttributes: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    },
    // Never add crossSubDomainCookies. It introduces `Domain=`, which a `__Host-` cookie
    // may not carry — so it would not widen the session, it would break sign-in entirely.
  },
});
// Emits: __Host-myapp.session_token
```

Pin the emitted name in a test, because nothing else will fail if someone "fixes" the flag:

```ts
const ctx = await auth.$context;
for (const c of [ctx.authCookies.sessionToken, ctx.authCookies.sessionData]) {
  expect(c.name.startsWith("__Host-")).toBe(true); // position 0, not `includes`
  expect(c.attributes.secure).toBe(true);
  expect(c.attributes.path).toBe("/");
  expect(c.attributes.domain).toBeUndefined();
}
```

## NOTES

- **The OAuth `state` cookie comes along for free, and it is the one that matters most.**
  It is built by the same `createAuthCookie` getter (`dist/state.mjs:61`), so `cookiePrefix`
  reaches it. Cookie forcing against an authorization server targets `state`/PKCE to attempt
  authorization-code injection — a higher-value target than the session cookie itself. Any
  hardening that covers only the session cookie misses it.
- Cookies built through this getter: `session_token`, `session_data`, `account_data`,
  `dont_remember`, plus plugin cookies (OAuth `state`, `admin_session`, two-factor). One
  `cookiePrefix` covers all of them; per-cookie `advanced.cookies[name].name` overrides are
  not needed.
- `stripSecureCookiePrefix()` (`dist/cookies/cookie-utils.mjs:17`) already handles
  `__Host-`, so the library's internal name normalization is prefix-aware. This composes
  with Better Auth rather than fighting it.
- **Renaming cookies invalidates every existing session** — the server simply stops finding
  the old name. Plan for one forced re-authentication.
- If a future release starts honouring its own exported `HOST_COOKIE_PREFIX`, delete this
  workaround and use the real option. A pinned-name test is what will tell you.
