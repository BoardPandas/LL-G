---
tech: express
tags: [rate-limiting, express-rate-limit, nat, keygenerator, ipkeygenerator, trust-proxy, reconnect-storm, multi-tenant]
severity: high
---
# A per-IP rate limit throttles the whole NAT'd site, not the abusive client

## PROBLEM
`express-rate-limit` keys on IP by default, so a limit written to mean "per client"
actually means "per public IP". Every machine at a customer site NATs out through
one address, so the budget belongs to the **office**, not the caller. A site with
more machines than the limit throttles itself, permanently, and no single client
is misbehaving.

Three things keep this hidden:

1. **Steady state looks fine.** Long-lived credentials mean each client calls
   rarely, so the cap is never approached — until something forces every client to
   call at once. An API restart drops every WebSocket, and the whole fleet
   reconnects together. The bug therefore appears *only just after a deploy*, which
   is exactly when you attribute it to the deploy itself.

2. **Client-side exponential backoff makes it worse, not better.** The shared
   bucket refills at a fixed rate while each client's own delay doubles
   independently. Losers of the race get pushed toward the backoff cap, so
   convergence takes far longer than `headcount / limit` suggests.

3. **The failure is silent when health is reported on a different path.** If
   heartbeat is a separate unthrottled route, throttled clients keep reporting
   themselves **online** while the channel they could not authenticate stays down.
   Operators see healthy machines and commands that vanish.

`app.set('trust proxy', N)` is necessary but **not** sufficient. It fixes *which*
IP you read (client instead of load balancer) — it does nothing about IP being the
wrong key. Setting it makes the limiter correct-looking and still wrong.

Diagnostic tell: every 429 is concentrated on one route while all other routes
from the same network return 200. That isolates a route-level limiter and rules
out a global one.

## WRONG
```js
// Reads as "10 requests/min per agent". It is not — the key is the IP, and all
// 77 machines at a customer site share one. The office gets 10/min between them,
// so 67 of them are locked out after every restart.
const commandTokenRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
});

router.post('/v1/agent/command-token', commandTokenRateLimit, handler);
```

## RIGHT
```js
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Tight budget keyed on the caller's own identity, so one flapping client
// cannot consume its neighbours' allowance.
const perAgent = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  keyGenerator: (req) => {
    const agentId = req.body?.agentId;
    return typeof agentId === 'string' && agentId
      ? `agent:${agentId}`
      // v7+: never return req.ip raw from a custom keyGenerator — ipKeyGenerator
      // applies the IPv6 subnet grouping that stops /64 rotation defeating it.
      : ipKeyGenerator(req.ip ?? '');
  },
});

// Wide per-IP ceiling kept purely as the abuse backstop: both limiters run
// BEFORE credential verification, and the identity above is caller-supplied,
// so invented IDs would otherwise face no limit at all.
const perIp = rateLimit({ windowMs: 60 * 1000, limit: 600 });

router.post('/v1/agent/command-token', [perIp, perAgent], handler);
```

## NOTES
- Choose the key so that one caller cannot spend another's budget. IP is only the
  right key when IP genuinely approximates identity — public signup, unauthenticated
  abuse surfaces. For fleet or tenant traffic it never does.
- Order matters: put the cheap wide IP bucket first so a flood is shed before the
  more expensive keyed lookup.
- Size the per-identity limit from credential lifetime, not from traffic. A token
  valid 24h needs ~1 request/day; anything above a few per minute means the client
  is flapping, which is the case actually worth throttling.
- Verify with an A/B across a restart rather than a quiet period: the reconnect
  storm is the condition that reproduces it, so a deploy is a free experiment.
  Compare 429-vs-200 on the route in equivalent windows before and after.
- Falling request *volume* after the fix is the confirming signal, not a worrying
  one — the old volume was inflated by clients retrying after rejection.
- Related: [rate-limit-skip-header-presence.md](rate-limit-skip-header-presence.md)
  covers the other way these limiters go wrong — exempting requests on unvalidated
  header presence. That one is about who you let *past* the limiter; this one is
  about what you *key* it on.
