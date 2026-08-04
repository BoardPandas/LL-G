---
tech: better-auth
tags: [rate-limiting, x-forwarded-for, trusted-proxies, ip-address, magic-link, bff-proxy, reverse-proxy]
severity: high
---
# Behind a two-hop proxy, rate limiting silently collapses into ONE global bucket

## PROBLEM

`getIPFromHeader` refuses to read a client IP from a multi-hop
`x-forwarded-for` chain unless `advanced.ipAddress.trustedProxies` is set. It
does not warn per request and it does not error -- it returns `null`:

```js
// better-auth/dist -> @better-auth/core/utils/ip.mjs
if (forwardedIps.length !== 1) return null;   // no trustedProxies configured
```

The rate limiter then keys every request in the process on the same literal
string:

```js
const key = createRateLimitKey(ip ?? NO_TRUSTED_IP_KEY, path);  // "no-trusted-ip"
```

So EVERY client on the planet shares one bucket per path. With the magic-link
plugin's built-in rule (`window: 60, max: 5`, spanning `/sign-in/magic-link`
AND `/magic-link/verify`), five requests per minute is the budget for your
entire user base. One person signing in exhausts it and the next person's
emailed link 429s.

Three things make this brutal to diagnose:

1. **The failure looks like a bad token, not a limit.** `/magic-link/verify`
   only consumes the token *inside* the handler. A 429 short-circuits before
   that, so the verification row survives untouched and expires later. The user
   sees `?error=INVALID_TOKEN` and a login screen; the DB shows an unconsumed
   token. Nothing says "rate limited."
2. **It works when you test it.** A quiet bucket lets the whole flow through, so
   it reproduces only under concurrency -- and "concurrency" here means two
   people, or one person retrying.
3. **The only standing symptom is cosmetic.** `session.ipAddress` is written
   from the same `getIp()`, so every session row has a blank IP. That reads as a
   logging nit, not as "rate limiting is globally broken."

`rateLimit.enabled` defaults to `isProduction`, so this is off in dev and on in
prod. It bites exactly where you cannot watch it.

A BFF that proxies auth to a separate API is the classic trigger: the edge adds
hop 1, your proxy's outbound call adds hop 2. An in-process Better Auth on the
same Next.js server stays at one hop and resolves fine -- so the staff app works
and the customer portal does not, from identical-looking config.

## WRONG

```ts
// Auth lives in a separate API; a Next.js BFF raw-proxies /api/auth/* to it.
// x-forwarded-for arrives as "<client>, <proxy>" -> length 2 -> getIp() === null
betterAuth({
  advanced: {
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for'],   // named, but NOT trusted
      ipv6Subnet: 64,
    },
  },
  // rateLimit omitted -> enabled in production, memory storage, per-replica
});
```

Naming the header is not the same as trusting it. Without `trustedProxies` the
header is read and then thrown away.

## RIGHT

Pick based on what the LAST hop is.

**If the last hop is private** (proxy reaches the API over the internal
network), declare the proxy ranges. `getIPFromHeader` walks right-to-left,
skipping trusted hops, and returns the first untrusted address:

```ts
advanced: {
  ipAddress: {
    ipAddressHeaders: ['x-forwarded-for'],
    trustedProxies: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
    ipv6Subnet: 64,
  },
},
```

**If the last hop is public** (proxy reaches the API over its public hostname,
so the appended address is a NAT/egress IP), `trustedProxies` on private ranges
does NOT help -- it returns the egress IP and every user shares *that*. Restate
the client IP in a single-value header, and gate it on a shared secret so a
direct caller cannot forge it:

```ts
// proxy: always delete before setting -- the browser can send these too
headers.delete('x-portal-client-ip');
headers.delete('x-internal-proxy-token');
const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
if (ip && TOKEN) {
  headers.set('x-portal-client-ip', ip);
  headers.set('x-internal-proxy-token', TOKEN);
}

// API: strip the claim unless the shared token proves it came from the proxy
if (req.headers['x-portal-client-ip'] && !tokenMatches(req.headers['x-internal-proxy-token'])) {
  delete req.headers['x-portal-client-ip'];
}
delete req.headers['x-internal-proxy-token'];

// auth config: the trusted header FIRST
advanced: { ipAddress: { ipAddressHeaders: ['x-portal-client-ip', 'x-forwarded-for'] } },
```

Also fix the two things the shared bucket was hiding:

```ts
rateLimit: {
  customStorage: redisStorage(),      // memory storage is PER REPLICA
  customRules: {
    '/sign-in/magic-link': { window: 60, max: 10 },
    '/magic-link/verify':  { window: 60, max: 30 },
  },
},
```

`customStorage` takes precedence over everything and does NOT require
`secondaryStorage` -- setting that instead would also move session storage out
of your database. Implement `consume(key, rule)` (atomic `INCR` + `EXPIRE` on
first hit) or Better Auth falls back to a non-atomic check-then-increment and
warns. Fail OPEN on storage errors: a limiter that locks every user out of login
when Redis blips is worse than briefly unmetered auth traffic.

## VERIFY

Do not trust code review here -- the whole point is that it fails silently.
Exhaust one client's bucket, then check a second client is untouched:

```bash
# 31 requests as client A -> expect 429 once past max
for i in $(seq 1 31); do
  curl -so /dev/null -w '%{http_code}\n' \
    -H "x-client-ip-header: 198.51.100.10" -H "x-proxy-token: $TOK" "$VERIFY_URL"
done
# client B must still get through on its own bucket
curl -so /dev/null -w 'B -> %{http_code}\n' \
  -H "x-client-ip-header: 198.51.100.20" -H "x-proxy-token: $TOK" "$VERIFY_URL"
# claiming A's exhausted IP WITHOUT the token must NOT inherit A's bucket
curl -so /dev/null -w 'forged -> %{http_code}\n' \
  -H "x-client-ip-header: 198.51.100.10" "$VERIFY_URL"
```

Before the fix, five requests from anywhere 429 the sixth from everywhere.

`SELECT ipAddress FROM <session table>` is the cheap standing check: all-blank
means `getIp()` is returning null and your rate limiting is global.

## NOTES

Confirmed on better-auth 1.6.23.

- Compounds with [magic-link verify is a GET that signs in](magic-link-verify-get-scanners.md).
  That one has a mail prefetcher consume the token; this one has a 429 leave it
  unconsumed. Both end at "the link doesn't work" with a live-looking or
  vanished token, so check which of the two you have before fixing either.
- Plugin rules override Better Auth's defaults, and `rateLimit.customRules`
  overrides plugin rules -- that is the only way to loosen a plugin's built-in
  limit without disabling rate limiting wholesale.
- Cross-domain handoff flows spend rate-limited requests in multiples (request
  link + verify on canonical host + verify on vanity host = 3), so a limit that
  looks generous per login is not.
- The same null-IP fallback silently blanks `session.ipAddress`, so any
  security review, audit log, or "recent sign-in locations" UI reading that
  column has been showing nothing.
