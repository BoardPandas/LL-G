---
tech: web-security
tags: [csrf, samesite, cookies, origin, same-site, ports, self-hosted, fastapi, cors]
severity: high
---
# `SameSite=Lax` treats every port on a host as the same site, so the host's other apps carry your session cookie

## PROBLEM
A "site" is the scheme plus the registrable domain, or the address itself for an IP. The port is not part of it. An app at `http://10.0.0.5:8585` with a `SameSite=Lax` session cookie still receives that cookie on requests sent by pages from `http://10.0.0.5:3000`, `:5055`, or any other service on the same box. To the browser those pages are same-site, only cross-origin. SameSite stops other sites, not other apps on your own host. A self-hosted box running a dozen web UIs is exactly where one of them serving hostile content (an XSS, a malicious plugin) can drive another app's writes with its user's session.

What still protects which writes:
- JSON writes: a cross-origin `fetch` with `Content-Type: application/json` needs a CORS preflight, and an app that never answers preflights blocks it. That holds only if the framework refuses to read a body as JSON without that header. FastAPI 0.141.1 does (`strict_content_type` defaults to true, so a body with no Content-Type gets 422). A framework that parses such a body as JSON anyway lets a no-preflight request through.
- Body-less writes, such as a sign-out form or `POST /downloads/pause`: nothing. A same-site form, or `fetch(url, {method: "POST", mode: "no-cors", credentials: "include"})`, is a simple request and carries the cookie.

## WRONG
```python
app.add_middleware(SessionMiddleware, secret_key=secret, same_site="lax")  # "covers CSRF for this app"
```

## RIGHT
```python
from urllib.parse import urlsplit

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def refuse_cross_site_writes(request, call_next):
    origin = request.headers.get("origin")
    if request.method in WRITE_METHODS and origin is not None and urlsplit(origin).netloc != request.headers.get("host"):
        return JSONResponse(status_code=403, content={"detail": "Cross-site request refused."})
    return await call_next(request)
```

## NOTES
- Browsers send `Origin` on POSTs, including same-origin form posts, so the app's own sign-out form passes. A request with no `Origin` (curl, server-to-server) has no browser cookie to borrow, and passes too.
- `Origin: null` fails the check. Sandboxed frames send it, and so do form posts under `Referrer-Policy: no-referrer`, so do not set that policy on an app guarded this way: [referrer-policy-nulls-origin-on-form-post.md](referrer-policy-nulls-origin-on-form-post.md).
- Behind a proxy that rewrites `Host`, compare the Origin with the public host instead.
- Verified on a FastAPI 0.141.1 app on a self-hosted box: a POST whose `Origin` named another port on the same address got 403 before any route code ran; the same POST with no `Origin` and no session got the usual 401.
