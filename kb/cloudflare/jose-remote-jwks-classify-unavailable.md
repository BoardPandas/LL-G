---
tech: cloudflare
tags: [jose, jwks, jwt, cloudflare-access, workers, error-handling, auth]
severity: high
---
# jose remote JWKS on Workers: classify key-fetch failures apart from bad tokens

## PROBLEM
`jwtVerify(token, createRemoteJWKSet(url))` throws for two very different reasons: the token is bad, or the key set could not be fetched. A single `catch -> 403` turns a JWKS/IdP outage (certs endpoint 5xx, timeout, garbled JSON) into "every client's token is invalid", which sends every caller off to re-authenticate and points the operator at the wrong problem.

Caching is the other half. On Cloudflare Workers jose itself drops any pending fetch begun by another request (`isCloudflareWorkers()` in `jwks/remote.js`), so a module-scope resolver is safe and never remembers a rejected fetch -- the next request retries. Wrapping it in your own promise cache is what would introduce the stuck-rejection bug (`typescript/async-singleton-race`).

In jose 6, `ERR_JOSE_GENERIC` is thrown only by the remote fetch path (non-200 or non-JSON certs response). `ERR_JWKS_TIMEOUT` and `ERR_JWKS_INVALID` also come from fetching/parsing the set, and anything that is not a `JOSEError` is the fetch itself failing. Every token-content failure is a different `JOSEError` subclass.

## WRONG
```ts
try {
  const { payload } = await jwtVerify(token, createRemoteJWKSet(new URL(certs)), opts);
  return { ok: true, payload };
} catch {
  return { ok: false, status: 403 }; // outage looks like a bad token
}
```

## RIGHT
```ts
// Module scope is fine: the resolver holds public keys only, and jose never reuses
// a fetch across requests on Workers.
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const UNAVAILABLE = new Set(["ERR_JOSE_GENERIC", "ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID"]);

try {
  const { payload } = await jwtVerify(token, keySetFor(teamDomain), {
    issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp"],
  });
  return { ok: true, payload };
} catch (err) {
  if (!(err instanceof errors.JOSEError) || UNAVAILABLE.has(err.code)) {
    return { ok: false, status: 503, reason: `keys_unavailable:${String(Object(err).name)}` };
  }
  return { ok: false, status: 403, reason: err.code };
}
```

## NOTES
- Test the recovery: a stub that fails the certs URL once, then serves it; the second request must succeed.
- Log the error name in the 503 reason, or a code bug (a `TypeError`) reads as the same outage.
- An unknown `kid` is `ERR_JWKS_NO_MATCHING_KEY` (403), not unavailable.
