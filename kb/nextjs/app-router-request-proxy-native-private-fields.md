---
tech: nextjs
tags: [app-router, nodejs, undici, request, proxy, bff, production-tests]
severity: high
---
# Reconstructing an App Router request fails native private-field checks

## PROBLEM

App Router wraps route-handler requests in a JavaScript Proxy to track dynamic
access. `new NextRequest(request, { headers })` looks like a safe way to add a
trusted outbound header, but Node's native Request constructor reads internal
private fields from its input. A Proxy is not the object that declared those
fields. It throws `TypeError: Cannot read private member #state from an object
whose class did not declare it` before the backend fetch happens.

Unit tests that invoke the handler with a bare `new NextRequest(url)` pass.
Production returns an empty HTTP 500 instead of the backend's JSON result. A
notification-settings screen then hides its enable action because configuration
never loads. Binding getters to the target does not make a Proxy valid as input
to a native constructor that reads private fields directly.

## WRONG

```ts
const headers = new Headers(request.headers)
headers.set('origin', configuredOrigin)
return proxyToBackend(new NextRequest(request, { headers }), path)
```

## RIGHT

```ts
// Validate the browser Origin at the cookie-bearing boundary first.
// Keep the original request and override only the outbound fetch header.
return proxyToBackend(request, path, { origin: configuredOrigin })

// Inside the existing proxy helper, after its normal header filtering:
if (options.origin !== undefined) headers.origin = options.origin
return fetch(backendUrl, {
  method: request.method,
  headers,
  signal: request.signal,
  // Preserve the existing streaming body and duplex handling for mutations.
})
```

## NOTES

- Reproduced with Node 24.21.0 and Next.js 16.3.8, including the production build.
- Keep origin, cookie, impersonation and CSRF enforcement unchanged. A header
  override must come from trusted server configuration after ingress validation.
- A regression test should wrap a real NextRequest with a target-bound `get`
  trap and assert forwarding, streamed body bytes and cancellation. Both GET and
  POST must pass without reconstructing the request.
- Also start the built standalone server against a local API fixture in CI.
  An unauthenticated config GET must preserve JSON 401, authenticated requests
  must reach the fixture, and hostile origins must be refused before credentials
  are forwarded. Bare handler mocks cannot prove the framework boundary works.
