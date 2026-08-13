---
tech: fastify
tags: [fastify, cors, preflight, delete, patch, put, methods, spa]
severity: high
---
# `@fastify/cors` defaults `methods` to GET,HEAD,POST — every PATCH/PUT/DELETE is preflight-blocked

## PROBLEM

`@fastify/cors` does not allow all methods by default. If you configure only
`origin` and `credentials` — the two options every example shows — the plugin
answers preflights with:

```
access-control-allow-methods: GET,HEAD,POST
```

so the browser refuses to send any `PATCH`, `PUT` or `DELETE`. Reads work
perfectly, which is what makes it survive: the app loads, lists render, detail
pages populate, and only *writes* fail. In a CRM-shaped app that was 31 call
sites — editing a record, completing or deleting a task, marking a notification
read — all dead, while the app looked healthy.

The failure is close to invisible from every angle except a real browser:

- **No server log.** A blocked preflight means the request is never sent. There
  is nothing to log, no 4xx, no handler invocation.
- **No entry in the network panel.** The request the browser refused to make
  does not appear, so it does not look like a failed call — it looks like the
  click did nothing.
- **`curl` passes.** curl does not preflight, so hand-testing the endpoint
  succeeds and "the API works" is confirmed by the obvious check.
- **The console says only** `TypeError: Failed to fetch`, which reads like a
  network blip rather than a policy rejection.

The one place the truth is visible is the OPTIONS response, which nobody looks
at until they suspect CORS.

## WRONG

```ts
await app.register(cors, {
  origin: [config.PUBLIC_APP_URL],
  credentials: true,
  // methods omitted -> defaults to GET,HEAD,POST.
  // Every mutating request from the SPA is rejected before it is sent.
});
```

## RIGHT

```ts
await app.register(cors, {
  origin: [config.PUBLIC_APP_URL],
  credentials: true,
  // Must be explicit. List every method the client actually issues.
  methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
});
```

## NOTES

- **Detect it in one command** — the answer is in the preflight, not the request:
  ```
  curl -i -X OPTIONS https://api.example.com/api/things/1 \
    -H "Origin: https://app.example.com" \
    -H "Access-Control-Request-Method: DELETE" | grep -i allow-methods
  ```
  If `DELETE` is missing from `access-control-allow-methods`, every delete in the
  app is already broken.
- **Audit the client, not your memory of it**: `grep -oE 'method: "(PATCH|PUT|DELETE)"'`
  over the API client gives the true blast radius. Ours reported 17 DELETE, 9
  PATCH, 5 PUT.
- Keep the allow-list in its own module and assert it in a unit test. Booting the
  whole app in a test usually drags in env validation (Better Auth validates the
  entire environment at import), so an isolated config module is what makes the
  regression test cheap enough to actually write.
- Same family: `Access-Control-Allow-Headers` defaults are similarly narrow, so a
  custom header (`x-request-id`, an API-key header) fails the same silent way.
- Related: a handler that writes through `reply.raw` bypasses this plugin
  entirely — see `reply-raw-bypasses-plugin-chain.md`.
