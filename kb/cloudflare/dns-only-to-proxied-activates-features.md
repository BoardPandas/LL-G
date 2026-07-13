---
tech: cloudflare
tags: [dns, proxied, tunnel, workers, redirect-rules, waf, access, cutover, migration]
severity: high
---
# Proxying a DNS-only record activates every Cloudflare-layer feature on that host

## PROBLEM
A DNS record set to "DNS only" (grey cloud) bypasses the Cloudflare proxy entirely: requests go straight to the origin, so Workers, Redirect Rules, Transform Rules, WAF, and Access policies scoped to that hostname NEVER run. The moment you flip the record to "Proxied" (orange cloud) -- which you must do to route a host through a Cloudflare Tunnel (`*.cfargotunnel.com`) -- all of those edge features suddenly apply. Any zone-wide Worker route (`*/*`), catch-all redirect rule, or WAF rule that was silently dormant now intercepts the newly-proxied host, often with no origin-side log because the edge handles (or redirects) the request before it reaches your server.

Real failure: a migration flipped `api.` and `control.` from DNS-only to proxied (to reach a tunnel). A pre-existing `*/*` Worker that rewrote all traffic to the app origin (for customer vanity domains) began hijacking `api.`/`control.`, sending them to the web app -- the API and admin portal became unreachable and the dashboard 500'd, all with `server: cloudflare` 307s and nothing in the origin logs.

## WRONG
```bash
# Cutover: just flip the record to proxied and point it at the tunnel.
# (No audit of what edge features now apply to this hostname.)
curl -X PATCH "$CF/zones/$ZONE/dns_records/$ID" \
  -d '{"type":"CNAME","content":"<tunnel-id>.cfargotunnel.com","proxied":true}'
# api.example.com now silently caught by an existing */* Worker route -> broken.
```

## RIGHT
```bash
# BEFORE proxying a host, audit every edge feature scoped to the zone/hostname:
gh api /zones/$ZONE/workers/routes            # */* routes will now run on this host
gh api /zones/$ZONE/rulesets                  # redirect / transform / WAF phases
gh api /accounts/$ACCT/access/apps            # Access policies (redirect-to-login)
# Add explicit passthrough/exclusions for the newly-proxied platform hosts, e.g.
# a Worker guard: if (PLATFORM_HOSTS.has(url.hostname)) return fetch(request);
# THEN flip the record to proxied.
```

## NOTES
Symptom fingerprint: an unauthenticated/edge redirect (`HTTP 307`, `location: /login?next=...`) with `server: cloudflare` and a `cf-ray`, while the same path hit directly on the origin (internal address) returns the correct response. That mismatch means an edge feature, not your app, is responsible. Worker subrequests back to the same zone are loop-protected (they go to origin), so `return fetch(request)` is a safe passthrough. Related: dormant zone features are a classic cause of "it worked on the old host but breaks behind the proxy."
