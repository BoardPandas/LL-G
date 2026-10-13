---
tech: nextjs
tags: [nextresponse, cookies, better-auth, logout, set-cookie]
severity: high
---
# NextResponse cookie mutations can discard appended Set-Cookie headers

## PROBLEM

An auth server returns several Set-Cookie expiry headers, including a Domain
attribute. A Next.js route appends those headers and then expires its own legacy
cookies through response.cookies.set(). The cookie helper rewrites the header
collection from its own cookie map. Headers appended directly beforehand can
disappear, or collapse with a same-named cookie on another domain/path. The route
still returns success while a domain-scoped auth cookie survives.

Observed with Next.js 16.3.8 while adding server-session revocation to logout.
The server revocation and browser cookie deletion are separate requirements.

## WRONG

```typescript
const response = NextResponse.json({ ok: true });
for (const cookie of upstream.headers.getSetCookie()) {
  response.headers.append('Set-Cookie', cookie);
}
response.cookies.set('legacy-session', '', { maxAge: 0, path: '/' });
```

## RIGHT

```typescript
const response = NextResponse.json({ ok: true });
response.cookies.set('legacy-session', '', { maxAge: 0, path: '/' });
// Complete cookie-helper mutations before preserving the upstream collection.
for (const cookie of upstream.headers.getSetCookie()) {
  response.headers.append('Set-Cookie', cookie);
}
```

## NOTES

Inspect the real response.headers.getSetCookie() values in a route test. Include
same-named cookies with different Domain/Path attributes and confirm all intended
expiry headers remain. A mock assertion that cookies.set was called cannot detect
the loss. Preserve upstream cookie attributes exactly and never split Set-Cookie
on commas because Expires dates contain commas.

This is a runtime response-composition problem. Application regression tests are
the appropriate enforcement; no agent-configuration guard is needed.
