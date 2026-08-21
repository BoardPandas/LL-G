---
tech: nextjs
tags: [nextjs, middleware, matcher, healthcheck, deploy, 307, negative-lookahead, silent-failure]
severity: high
---
# An auth middleware matcher swallows your health endpoint, so the deploy probe gets a 307 and the deploy fails

## PROBLEM

A negative-lookahead middleware matcher like `'/api/((?!auth|webhooks).*)'` is written to
mean "protect every API route except the public ones." The moment you add a *new* public
route, the matcher silently starts protecting it, because the exception list is an
allowlist that nobody updates.

The case that bites hardest is a health endpoint, because of what consumes it. You add
`GET /api/health`, write it deliberately without session/rate-limit/billing wrappers so it
can answer before any user exists, unit-test it, and ship. The route handler is correct.
It just never runs: middleware intercepts first, finds no session, and returns
`307 -> /login`.

Why this is worse than an ordinary broken route:

- **Every local and unit test passes.** The handler is fine in isolation, and middleware
  does not run in a Vitest/Jest unit test. Only a real HTTP request through the running
  app reveals it.
- **A 307 is not an error.** `curl` without `-f` exits 0. A monitoring check written as
  "did it respond?" passes. Only a check asserting `200` catches it.
- **It converts a safety feature into an outage.** Container orchestrators (Railway,
  Fly, Kubernetes, ECS) treat a non-2xx healthcheck as a failed deploy. So the endpoint
  you added to *stop* bad deploys going green now fails **every** deploy, including good
  ones, from the moment you point the platform at it. If you wire the probe and the route
  in the same change, you get a deploy loop with a confusing cause.

The matcher is a regex in an exported config object. TypeScript does not check it, ESLint
does not lint it, and nothing else in the app exercises it, so it is invisible to every
gate in the repo.

## WRONG

```ts
// src/middleware.ts  (or proxy.ts)
export const config = {
  matcher: [
    '/dashboard/:path*',
    // "all API routes except auth and webhooks" -- an allowlist that goes stale
    // the moment any new public route is added.
    '/api/((?!auth|webhooks).*)',
  ],
};
```

```ts
// src/app/api/health/route.ts -- correct handler, deliberately unwrapped
export async function GET() {
  const [database, redis] = await Promise.all([pingDb(), pingRedis()]);
  const healthy = database && redis;
  return NextResponse.json({ status: healthy ? 'ok' : 'degraded' },
                           { status: healthy ? 200 : 503 });
}
```

```bash
# Unit tests green, handler logic correct, and yet:
$ curl -s -o /dev/null -w '%{http_code}\n' https://app.example.com/api/health
307
$ curl -s https://app.example.com/api/health
/login
# Point the platform's healthcheck at this path and every deploy now fails.
```

## RIGHT

```ts
export const config = {
  matcher: [
    '/dashboard/:path*',
    // API routes, EXCEPT the ones that must answer without a session:
    //   auth     -- the sign-in flow itself
    //   webhooks -- inbound, authenticated by HMAC/token rather than session
    //   health   -- the deploy probe; polled before any user exists, and a
    //               307 to /login reads to the orchestrator as a failed check
    '/api/((?!auth|webhooks|health).*)',
  ],
};
```

Pin it with tests, because nothing else will. The matcher is exported, so it is directly
testable without booting the app:

```ts
import { config } from '@/middleware';

const API_MATCHER = config.matcher.find((m) => m.startsWith('/api/'))!;
const re = new RegExp(`^${API_MATCHER}$`);

it.each([
  '/api/health',
  '/api/auth/get-session',
  '/api/webhooks/stripe',
])('does NOT intercept %s', (p) => expect(re.test(p)).toBe(false));

it.each([
  '/api/me',
  '/api/services',
  '/api/admin/users',
])('DOES intercept %s', (p) => expect(re.test(p)).toBe(true));
```

Then verify against the deployed URL, not just the test suite:

```bash
# -f makes curl exit non-zero on any non-2xx, so a 307 fails loudly.
curl -fsS https://app.example.com/api/health | jq
```

## NOTES

**Assert the status code, never just "it responded."** A redirect satisfies "responded",
"returned quickly", and "is reachable". The whole failure hides in the gap between those
checks and `== 200`.

**Sequence the rollout so the probe cannot break you:** deploy the route first, confirm it
returns 200 over real HTTP, and only then set the platform's healthcheck path. Doing both
in one change turns a five-second fix into a deploy loop where the healthcheck you just
added is the thing failing.

**The `health` case generalises.** Anything polled by infrastructure rather than by a
signed-in human is exposed to this: `/api/health`, `/api/ready`, `/api/metrics`,
`/.well-known/*`, ACME HTTP-01 challenge paths, and OAuth/SAML callback routes. Each one
needs to be in the exception list *and* in the matcher test above.

**The inverse mistake is worse and quieter.** Broadening the lookahead to fix this can
un-protect real routes: `'/api/((?!auth|webhooks|health|admin).*)'` typo'd in a hurry
leaves `/api/admin/*` unauthenticated with no error anywhere. That is precisely why the
"DOES intercept" half of the test matters as much as the "does NOT" half -- test both
directions or you have traded a visible outage for a silent authorization hole.

**Do not put a health endpoint on a service with no HTTP server.** A queue worker
(BullMQ, Sidekiq, a bare consumer) has no listening port, so an HTTP probe there fails
every deploy rather than protecting it. Where worker and web share the same database and
cache URLs, the web probe already covers the same dependencies.
