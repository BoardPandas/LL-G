---
tech: cloudflare
tags: [dns, proxy, orange-cloud, keep-alive, http2, connection-reuse, origin-lock, railway]
severity: high
---
# Proxying a host does not move clients that already hold a connection to the origin

## PROBLEM
After a DNS record is switched from DNS-only to proxied, new connections go through Cloudflare, but clients that already have a connection open to the origin keep using it. Those clients bypass the proxy and its WAF with no error and no log line at the edge. Restarting the origin app does not close them, and a `Connection: close` sent by the app may not reach the client through the hosting platform's edge. A dashboard that says "proxy enabled" stays green. Origin-side rules that depend on Cloudflare headers (for example, a required header added by a Transform Rule) then reject only the clients that re-connect, which makes the cutover look like a partial outage.

## WRONG
```
# Switch the record to proxied, restart the app, and assume every client now goes through Cloudflare.
# Clients with a keep-alive or HTTP/2 connection to the origin keep sending requests straight to it.
```

## RIGHT
Check a fresh connection, not an existing one. The first request that a new connection sends should carry `cf-ray`:
```
curl -sS -o /dev/null -D - https://api.example.com/health | grep -i '^cf-ray'
```
Then make the client itself release old connections. Close idle connections on a timer, and close a connection after any 403 from a gate, so the client re-resolves DNS on its next connect. A server-side close is not enough if the platform edge does not forward it. Stage any origin-side enforcement only after the client has reconnected through Cloudflare, and count requests without the expected header for 24 hours before enforcing.

## NOTES
- Observed on a Railway-hosted origin in front of Cloudflare, 2026-11: a 403 came back twice on the same HTTP/2 connection, and a `Connection: close` over HTTP/1.1 reached the client as `keep-alive`.
- Related: [Proxying a DNS-only record activates every Cloudflare-layer feature on that host](dns-only-to-proxied-activates-features.md) covers what the proxy switches on. This entry covers which clients actually reach the proxy.
- Applies to any long-lived client connection: agents, WebSocket clients, and HTTP/2 pools.
