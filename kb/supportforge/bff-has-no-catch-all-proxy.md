---
tech: supportforge
tags: [bff, nextjs, app-router, route-handler, proxy, 404, dashboard, api]
severity: high
---
# A mounted API route still 404s from the dashboard until its BFF proxy handler exists

## PROBLEM

The dashboard is a Next.js BFF in front of the Express API, and it proxies
**per endpoint**: every path the browser calls needs its own `route.ts` under
`dashboard/src/app/api/...`. There is no catch-all at the root.

So an endpoint that is implemented, mounted, covered by passing tests, and
reachable with curl against `api.supportforge.ai` still answers **404 in the
browser**. Next matches no route and returns its own 404 before the request
ever leaves the dashboard container, so nothing appears in the API logs — the
API never saw it.

That is what makes it expensive: debugging naturally starts at the API. Is the
router mounted? Is a wildcard shadowing the literal path? Is middleware
rejecting it? Every one of those checks passes, because the API is fine.

`/v1/dashboard/nav-counts` shipped this way. The handler and its mount landed
with the section nav and never moved; `dashboard/src/app/api/v1/dashboard/`
contained only `tickets/*`. The Devices, Organizations and People counts were
silently absent from the sidebar for ~90 commits, and every page load logged a
404 that looked like a backend fault.

**The distinguishing signal:** curl the *dashboard* host unauthenticated. A
JSON body (`{"error":"staff-only"}`) means the proxy exists and the request
reached the API. Next's HTML 404 page means there is no handler. Curling
`api.supportforge.ai` directly proves nothing about the path the browser takes.

## WRONG

```ts
// src/routes/dashboard-nav-counts.ts  — API side, correct and complete
router.get(`${API_V1}/dashboard/nav-counts`, requireStaff, handleNavCounts);

// src/routes.ts
router.use('/', dashboardNavCountsRouter);

// ...and nothing else. The browser calls /api/v1/dashboard/nav-counts and gets
// a Next 404. Tests pass, the route is mounted, the API logs are clean.
```

## RIGHT

```ts
// The API side above, PLUS the proxy handler that carries the browser to it:
// dashboard/src/app/api/v1/dashboard/nav-counts/route.ts
import { NextRequest } from 'next/server'
import { proxyToBackend } from '@/lib/api/bff-proxy'

export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/v1/dashboard/nav-counts', { cache: 'no-store' })
}
```

```bash
# Verify against the DASHBOARD host, not the API host. JSON = proxied.
curl -s https://core.supportforge.ai/api/v1/dashboard/nav-counts
# {"error":"staff-only"}   <- handler exists, request reached the API
# <!DOCTYPE html>...       <- no handler; the API is irrelevant to this failure
```

## NOTES

- Some namespaces already have `[...path]` catch-alls covering a whole subtree
  (`/api/v1/personas/[...path]`, `/api/v1/portal/settings/[...path]`), so a new
  endpoint under those needs no new file. Check for one before adding a
  handler — and note a catch-all only serves the **verbs it exports**, so
  adding a POST to a subtree whose route file exports only GET 404s the same
  silent way.
- Adding an endpoint is therefore a two-file change by default. When an
  endpoint "exists but 404s", check the BFF before touching the API.
- Related: the BFF forwards every client header except `host`, so any header
  the API trusts, the browser can set — audit header-trust and BFF forwarding
  as one question.
