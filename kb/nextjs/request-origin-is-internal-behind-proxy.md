---
tech: nextjs
tags: [route-handler, redirect, proxy, railway, req.url, nextUrl, origin, localhost, stripe, oauth]
severity: high
---
# req.url / nextUrl.origin is the container's internal address behind a proxy

## PROBLEM

In an App Router route handler deployed behind a reverse proxy (Railway, and the
same holds for comparable PaaS edges), `req.url` and `req.nextUrl.origin` resolve
to the container's **internal bind address** — `http://localhost:8080` or
`http://localhost:3000` — while the `Host` header still carries the real public
hostname. Any absolute URL built from that origin points at an address only the
container can reach.

Locally it is always correct, so nothing surfaces until production.

The redirect case is the nastiest, because the failure is *partial*:

```
NextResponse.redirect(new URL(next, url.origin))
  -> Location: http://localhost:8080/dashboard
  -> browser: ERR_CONNECTION_REFUSED
```

On an auth-handoff or session-establishing endpoint, the `Set-Cookie` headers on
that same response land **correctly** on the real host. The user genuinely *is*
signed in — only the redirect target is dead. Re-typing the real hostname by hand
reveals a perfectly good session, so it presents as an intermittent *login* bug
rather than a *redirect* bug, and the auth code gets audited for hours before
anyone reads the Location header. It also bites hardest on first-visit flows,
which is exactly when the redirect is unavoidable.

## WRONG

```ts
export async function GET(req: NextRequest) {
  const url = new URL(req.url);           // origin === http://localhost:8080 in prod
  const next = url.searchParams.get("next") ?? "/";

  // Location: http://localhost:8080/dashboard  -> ERR_CONNECTION_REFUSED
  return NextResponse.redirect(new URL(next, url.origin), 302);
}
```

## RIGHT

```ts
export async function GET(req: NextRequest) {
  const next = safePath(new URL(req.url).searchParams.get("next")); // params are fine
  const res = new NextResponse(null, {
    status: 302,
    // RELATIVE Location: the browser resolves it against the address it actually
    // requested. NextResponse.redirect() requires an absolute URL, so build the
    // response by hand to go relative.
    headers: { Location: next, "Cache-Control": "no-store" },
  });
  return res;
}

// Where an absolute URL is genuinely required (Stripe, emailed links), take it
// from configuration -- never from the request.
const origin = process.env.NEXT_PUBLIC_APP_URL; // e.g. https://app.example.com
await stripe.checkout.sessions.create({ success_url: `${origin}/done`, /* ... */ });
```

## NOTES

- **Reading `searchParams` off `new URL(req.url)` is completely fine.** Only the
  ORIGIN is untrustworthy, so this does not mean auditing every `new URL(req.url)`
  in the codebase — only the ones whose result is used to build an outbound URL.
- A relative `Location` has a second benefit in multi-domain deployments: it keeps
  the user on whichever host they arrived on, instead of pinning everyone to one
  origin. Validate the path first (reject `//evil.com`, `/\evil.com`, and control
  characters) — a relative Location is only same-origin if the value really is a
  path.
- **Other things this silently breaks**, all with the same root cause:
  - Stripe `success_url` / `cancel_url` — Stripe *rejects* localhost URLs in live
    mode, so this one at least fails loudly.
  - OAuth callback redirect URIs — the provider rejects the mismatch.
  - Any emailed link built from the request (verification, magic link, digest) —
    these fail silently and land in inboxes, where they stay broken.
- Using the `Host` header is a viable third option, but only after validating it
  against an allowlist (it is client-supplied), and watch for port suffixes and
  `www.` normalization changing the host you emit.
- Same class of bug as
  [Next.js standalone server binds to process.env.HOSTNAME](standalone-hostname-binding.md):
  the runtime's idea of its own address is not the address clients used.
