---
tech: railway
tags: [private-networking, ipv6, nodejs, hono, railway-internal]
severity: high
---
# A Node server bound to 0.0.0.0 is unreachable on Railway's IPv6-only private network

## PROBLEM
Binding a Node server to `0.0.0.0` makes it IPv4-only, and Railway environments created before 2025-10-16 have an IPv6-only private network, so `<service>.railway.internal` callers can't connect.
The public domain and health checks keep working, because they arrive over IPv4. Only service-to-service calls fail, with connection refused or a timeout. Newer environments are dual-stack, so the same code works in one environment and fails in another.

## WRONG
```ts
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
```

## RIGHT
```ts
// "::" accepts IPv6 and (dual-stack on Linux) IPv4.
serve({ fetch: app.fetch, port, hostname: "::" });
```

## NOTES
- Omitting `hostname` also binds `::` in Node.
- Callers use `http://<service>.railway.internal:<the port the service listens on>`.
- Private networking works only at runtime, never during the build.
