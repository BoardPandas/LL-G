---
tech: railway
tags: [cookies, public-suffix, samesite, better-auth, caddy, reverse-proxy]
severity: high
---
# up.railway.app is a public suffix, so an api on its own Railway domain can't set a session cookie for the SPA

## PROBLEM
`up.railway.app` is on the Public Suffix List, so `web-x.up.railway.app` and `api-y.up.railway.app` are different sites, and a session cookie the api sets never reaches the SPA's requests.
Both hosts look like subdomains of one domain, so it seems a `SameSite=Lax` cookie (or `crossSubDomainCookies`) should work. It doesn't: `SameSite=Lax` cookies aren't sent on cross-site fetches. `SameSite=None` makes them third-party cookies, and Safari blocks those. A `Domain=up.railway.app` cookie is rejected outright. Sign-in appears to succeed, and then every request is unauthenticated.

## WRONG
```text
SPA:  https://web-x.up.railway.app   fetch("https://api-y.up.railway.app/api/auth/...", { credentials: "include" })
api:  BETTER_AUTH_URL=https://api-y.up.railway.app   (cookie set on the api host only)
```

## RIGHT
```caddyfile
# Serve the api from the SPA's origin; the cookie is first-party on the web host.
:{$PORT:8080} {
	@api path /api/* /v1/*
	handle @api {
		reverse_proxy api.railway.internal:8080
	}
	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
}
```
Then set `BETTER_AUTH_URL` to the web origin. OAuth redirect URIs use the web domain, and the SPA calls the api by relative path.

## NOTES
- The same applies to any PSL-listed host: `*.vercel.app`, `*.pages.dev`, `*.herokuapp.com`, `*.onrender.com`.
- Custom domains on one registrable domain (`app.example.com` and `api.example.com`) are the same site, so they avoid this.
- Proxying adds a hop. Decide how `X-Forwarded-For` reaches the api (see better-auth/rate-limit-shared-bucket-multi-hop-xff).
