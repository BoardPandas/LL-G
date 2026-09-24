---
tech: nextjs
tags: [bff, csrf, fetch, content-type, testing, origin]
severity: high
---
# Bodyless POST can fail a JSON CSRF guard before proxy defaults apply

## PROBLEM

A signed-in dashboard action sends a bodyless POST. Its fetch wrapper only adds
Content-Type when a body is present. The BFF checks JSON Content-Type, Origin and
Fetch Metadata before converting the ambient cookie into a backend Bearer token.
The browser request therefore receives 403 even though component tests that mock
fetch as successful pass. A proxy helper that later supplies application/json
cannot repair a request already refused by the guard.

This looks like a login failure or expired session. Repeating a credential flow
does not change the malformed dashboard request. In SupportForge's September 24
attended viewer lab, it prevented Open viewer from reaching the join endpoint.

## WRONG

```ts
// The wrapper only sets Content-Type when body is present.
await apiFetch(`/remote-sessions/${sessionId}/join`, { method: 'POST' })

// This never exercises the BFF boundary.
global.fetch = jest.fn().mockResolvedValue(successfulJoin)
```

## RIGHT

```ts
// Use the route's actual contract. This join route accepts an empty object.
await apiFetch(`/remote-sessions/${sessionId}/join`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
```

Keep the CSRF guard before cookie-to-Bearer conversion. Exercise the real guard
using the headers produced by the UI request. Assert that missing JSON, missing
Origin, untrusted origins, cross-site requests and form submissions are refused
before the backend fetch. Do not weaken authorization to make the action pass.

Also run a credential-free production-server smoke with a loopback backend. In
this incident that exposed a second blocker: Next constructed its URL with the
internal bind address. The test sent the public Host and Origin through that
runtime, while negative cases remained rejected. Match public host only against
explicitly trusted configured origins; never trust an arbitrary forwarded host.

## NOTES

- An empty JSON object is suitable only if the endpoint accepts it. Otherwise
  send its documented body and JSON Content-Type, or its explicitly supported
  bodyless contract with the required header.
- See [internal request origin behind a proxy](request-origin-is-internal-behind-proxy.md).
- Validate the browser-to-BFF and BFF-to-backend contracts separately. Backend
  route tests alone cannot catch a BFF refusal.
- Product regression tests enforce this technology lesson; no agent-configuration
  eval case is appropriate.
