---
tech: better-auth
tags: [magic-link, rate-limit, catch-all, abuse, email]
severity: high
---
# A custom rate-limited sign-in route does not cover Better Auth's own magic-link endpoint

## PROBLEM
Apps often send magic links from their own route (to add per-email and per-IP limits, a neutral "check your email" page, or an inert landing page) and call `auth.api.signInMagicLink` server-side. Better Auth's handler is usually also mounted on a catch-all such as `/api/auth/*`, which leaves the plugin's own `POST /api/auth/sign-in/magic-link` reachable. Anyone can call it directly and send mail from your domain with none of your limits applied. Nothing fails; the bypass is invisible until the sending domain's reputation is burned.

## WRONG
```ts
app.post("/signin/magic-link", limited, async (c) => {
  await auth.api.signInMagicLink({ body: { email }, headers: c.req.raw.headers });
});
app.all("/api/auth/*", (c) => auth.handler(c.req.raw)); // also serves /sign-in/magic-link
```

## RIGHT
```ts
// Registered BEFORE the catch-all. In-process auth.api calls do not pass through the
// HTTP router, so the app's own route keeps working.
app.all("/api/auth/sign-in/magic-link", (c) => c.notFound());
app.all("/api/auth/*", (c) => auth.handler(c.req.raw));
```

## NOTES
- Add a test that POSTs the native path and asserts no mail is sent, including respellings (trailing slash, doubled slash, different case, percent-encoding).
- The same question applies to every plugin endpoint that sends mail or SMS: list what the catch-all exposes.
