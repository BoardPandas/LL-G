---
tech: express
tags: [security, rate-limiting, express-rate-limit, headers, dos]
severity: medium
---
# Rate-limiter skip() on unvalidated header presence disables throttling for attackers

## PROBLEM
express-rate-limit's `skip` callback runs BEFORE route auth. Exempting paths because the request merely carries an auth-looking header (`Authorization`, `x-agent-id`, `x-admin-token`) means an unauthenticated attacker can attach arbitrary header values and turn off the global limiter for those paths, then brute-force tokens or hammer expensive endpoints. The route still rejects the bad credential, but the IP-level throttle that should slow the attempts is gone. Easy to introduce when trying to stop legitimate agents or CI from hitting 429s.

## WRONG
```ts
const limiter = rateLimit({
  windowMs: 60_000,
  max: 1000,
  skip: (req) => {
    const hasAgentAuth = !!(req.get('Authorization') && req.get('x-agent-id'));
    const hasInternal = !!req.get('x-admin-token'); // presence only, never compared
    if (hasAgentAuth && req.path.startsWith('/v1/agents/')) return true;
    if (hasInternal && req.path.includes('/maintenance/')) return true;
    return false;
  },
});
```

## RIGHT
```ts
const limiter = rateLimit({
  windowMs: 60_000,
  max: 1000,
  skip: (req) => {
    // Only skip when the credential actually validates (constant-time compare)
    const expected = process.env.INTERNAL_API_TOKEN;
    const provided = req.get('x-admin-token');
    if (expected && provided && timingSafeEqualStr(provided, expected)
        && req.path.includes('/maintenance/')) return true;
    return false;
  },
});
// For agent traffic, do not exempt: give it its own higher-ceiling bucket
const agentLimiter = rateLimit({
  windowMs: 60_000,
  max: 5000,
  keyGenerator: (req) => req.get('x-agent-id') || req.ip, // per-agent, falls back to IP
});
app.use('/v1/agents', agentLimiter);
```

## NOTES
Rule of thumb: `skip` may only depend on facts the limiter can verify itself (validated token, allowlisted internal IP). Anything attacker-settable (header presence, header value without comparison, User-Agent) must not influence skipping. Prefer separate limiter buckets with higher ceilings over full exemptions.
