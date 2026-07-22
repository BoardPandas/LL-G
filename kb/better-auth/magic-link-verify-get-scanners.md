---
tech: better-auth
tags: [magic-link, passwordless, email, link-scanner, safe-links, prefetch, session, two-factor, silent-failure]
severity: high
---
# magic-link verify is a GET that signs in — link scanners consume the token

## PROBLEM
The magicLink plugin's `/magic-link/verify` is `method: "GET"` and performs the
entire sign-in as a side effect of the fetch. Verified in better-auth 1.6.23,
`node_modules/better-auth/dist/plugins/magic-link/index.mjs:118-160`: it calls
`internalAdapter.consumeVerificationValue(storedToken)` — atomic, single-use —
then `createSession()` and `setSessionCookie()`.

So **anything that follows the emailed URL is signed in**. Not "leaks the token" —
it receives a live session cookie for the user's account, and burns the token in
the process, so the real user's click afterwards arrives with an already-spent
token and lands unauthenticated. To the user this is a magic link that simply
does not work; to your logs it is a successful sign-in from an IP the user has
never used.

This is not theoretical. Production evidence, 2026-07-22: Microsoft Defender for
O365 **Safe Links** prefetched a magic link seconds after issuance from rotating
Azure IPs (`74.179.x`, `72.152.x`, `72.153.x`, `135.232.20.2`) with Windows Chrome
user agents (including `Windows NT 6.1`), consumed the token, and got the session.
The user's own click then failed. Every corporate mail security product does this
— Safe Links, Proofpoint URL Defense, Mimecast, Barracuda — plus Slack/Teams/iMessage
unfurlers and Gmail's image proxy. Blocking by IP or UA is not a mitigation; the
ranges rotate and the UAs are indistinguishable from real browsers.

**`allowedAttempts` is not the escape hatch.** In 1.6.23 it is explicitly ignored
(`index.mjs:28-31` warns: *"tokens are consumed atomically on the first verification
call. Any value other than `1` has no effect"*). Limited-reuse is not configurable.

**The fix is the shape better-auth itself already uses for password reset**, where
`GET /reset-password/:token` only does a non-consuming `findVerificationValue`
(`dist/api/routes/password.mjs:83,116`) and the token is spent only by
`POST /reset-password`. Magic link is the outlier. Mirror the reset-password shape:
land the emailed link on an inert page, consume via POST behind a real click.

## WRONG
```typescript
// auth.ts — emailed link points straight at the consuming GET endpoint
magicLink({
  // `url` here is `<origin>/api/auth/magic-link/verify?token=…&callbackURL=…`
  sendMagicLink: async ({ email, url }) => {
    await sendEmail({ to: email, body: `<a href="${url}">Sign in</a>` });
  },
  allowedAttempts: 3, // ignored in 1.6.23 — console warning, no effect
});
```
Safe Links fetches that href during mail delivery. `consumeVerificationValue`
succeeds for the scanner, `setSessionCookie` hands it a session, and the user's
click gets `?error=INVALID_TOKEN`.

## RIGHT
```typescript
// 1. auth.ts — rewrite the emailed URL to an inert app page, and disable the
//    HTTP-facing verify route so only server-side code can reach it.
export const auth = betterAuth({
  // `disabledPaths` is enforced ONLY in better-auth's HTTP router `onRequest`
  // (dist/api/index.mjs:164-166). Server-side `auth.api.*` still works — which
  // is exactly what makes this pattern implementable.
  disabledPaths: ["/magic-link/verify"],
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        const src = new URL(url);
        const target = new URL("/magic-link", src.origin); // inert page
        target.searchParams.set("token", src.searchParams.get("token")!);
        // Only a bare in-app path survives — never hand a caller-supplied
        // origin to a freshly-authenticated session.
        const cb = src.searchParams.get("callbackURL");
        if (cb?.startsWith("/") && !cb.startsWith("//")) {
          target.searchParams.set("callbackUrl", cb);
        }
        await sendEmail({ to: email, body: `<a href="${target}">Sign in</a>` });
      },
    }),
  ],
});

// 2. POST /api/auth/magic-link/confirm — the ONLY path that spends a token.
//    Reached from a button on /magic-link, so a prefetch cannot trigger it.
export async function POST(req: NextRequest) {
  const { token, callbackUrl } = magicLinkConfirmSchema.parse(await req.json());

  // Deliberately NO callbackURL: with one the endpoint answers with a thrown
  // redirect; without one it returns JSON, which is what lets you inspect the
  // outcome instead of blindly forwarding a 302.
  const upstream = await auth.api.magicLinkVerify({
    query: { token },
    headers: req.headers,
    asResponse: true,
  });

  // Expired / unknown / already-spent comes back as a redirect carrying
  // `?error=`, not a JSON error — see the plugin's `redirectWithError`.
  if (upstream.status >= 300 && upstream.status < 400) {
    return apiError("This sign-in link is no longer valid", 400);
  }
  // Forward Set-Cookie from `upstream` and return an explicit destination.
}
```

## NOTES
- **The interstitial page must consume nothing.** Render token + a submit button
  only. No `useEffect` auto-POST — a scanner that executes JS would trip it, and
  it re-creates the bug you just fixed.
- **`disabledPaths` is HTTP-router-only.** Enforced in `onRequest`
  (`dist/api/index.mjs:164-166`) by exact normalized-path match; it returns 404
  before rate limiting and plugin hooks. It does **not** gate `auth.api.*` server
  calls. That asymmetry is the whole mechanism here — treat it as load-bearing,
  and pin it with a test, since a version that moved the check deeper would
  silently break your confirm route.
- **Magic link bypasses your 2FA plugin entirely.** The twoFactor plugin's matcher
  covers only `/sign-in/{email,username,phone-number}`
  (`two-factor/index.mjs:191-192`). `/magic-link/verify` calls `createSession` +
  `setSessionCookie` directly, so a 2FA-enrolled user is fully signed in by an
  emailed link with no second factor. Closing this needs a custom plugin `after`
  hook on `/magic-link/verify` that deletes the session cookie and starts a
  challenge, mirroring what the twoFactor plugin's own hook does. Watch out for
  MFA gates that check *"has a factor enrolled"* rather than *"used one this
  session"* — those pass a magic-link session straight through.
- **Rate limiting does not carry over.** The plugin's `pathMatcher` 5-per-60s cap
  on `/magic-link/*` is router-level, so it does not apply to a `auth.api.*` call
  from your own route. The send side (the expensive one — it emails) is still
  covered. On confirm, the token itself is the control.
- Same-origin-check the confirm POST. The token is the real secret, but there is
  no legitimate cross-origin caller.
- Reference implementation: `vigilis` commit `aade7d88` —
  `src/lib/auth/magic-link-url.ts`,
  `src/lib/auth/magic-link-two-factor-plugin.ts`,
  `src/app/api/auth/magic-link/{confirm,verify}/route.ts`,
  `docs/core/AUTHENTICATION.md` § "Magic Link Sign-In".
- Related: [two-factor-redirect.md](two-factor-redirect.md).
