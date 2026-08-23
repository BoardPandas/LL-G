---
tech: railway
tags: [cdn, caching, curl, http, head-request, x-cache, diagnostics, false-negative]
severity: high
---
# `curl -I` reports `x-cache: DYNAMIC` on a URL the CDN caches perfectly over GET

## PROBLEM

`curl -I` sends **HEAD**, not GET. Railway's edge answers HEAD with `x-cache: DYNAMIC` ("fetched from your service and not cached") even for URLs it caches correctly on GET. The same URL, requested with GET moments later, returns `MISS` then `HIT`.

This inverts the standard reflex. Checking cache behaviour means checking response *headers*, and the header-only flag is `-I`, so the natural command produces a confident false negative. It is not a fluke you can dismiss either: HEAD returns `DYNAMIC` **every time**, so repeating the check reinforces the wrong answer, and repeating it is exactly what you do when the first result looks off.

The docs actively point the wrong way. Railway's CDN reference lists cacheable requests as "the method is `GET` or `HEAD`", so HEAD reads as fully supported and there is nothing to warn you the diagnostic path differs from the served path.

What makes it costly is that `DYNAMIC` is a *substantive* answer, not an error. It has a documented meaning ("the edge reached your service but couldn't cache the response"), which sends you to the list of reasons a response is skipped, and the response genuinely satisfies none of them:

```
cache-control: public, max-age=31536000, immutable   <- not no-store, not private
vary: Accept-Encoding                                <- not Vary: * or Vary: Cookie
content-type: application/javascript; charset=UTF-8  <- a recognized static type
content-length: 7637                                 <- nowhere near the 512 MB cap
(no Set-Cookie)
```

A content-hashed, immutable JS chunk that should be a textbook `HIT` reporting `DYNAMIC` reads as a platform-side fault. The conclusion drawn here was "CDN caching is enabled but nothing is actually caching, the toggle may not have saved" -- which led to toggling a correct production setting off and on to fix a problem that never existed. The real risk is the next step: changing HTML caching mode, raising the TTL, or filing a support ticket, all on evidence produced by the measurement rather than the system.

## WRONG

```bash
# HEAD. Reports DYNAMIC forever, on a URL that caches fine.
curl -sI https://app.example.com/_next/static/chunks/abc123.js | grep -i x-cache
# x-cache: DYNAMIC
# x-cache: DYNAMIC      <- repeating "confirms" it
```

## RIGHT

```bash
# GET, discarding the body but keeping the headers (-D - -o /dev/null).
URL=https://app.example.com/_next/static/chunks/abc123.js
for i in 1 2 3; do
  curl -s -D - -o /dev/null "$URL" | grep -iE '^(x-cache|age)'
done
# x-cache: MISS     <- fetched from origin and stored
# x-cache: HIT      <- served from the edge
# x-cache: HIT
```

The first GET is expected to be `MISS`: caches populate on a real request. Judge on the **second** one. A rising `age` across later requests confirms the same stored copy is being reused.

## NOTES

**One GET proves nothing.** A single `MISS` is indistinguishable from "not cacheable". You need at least two, and you must request the *same* URL: query parameters are part of the cache key, so a cache-buster appended out of habit guarantees a `MISS` every time and reproduces the original false negative by a different route.

**Verify both directions when HTML caching is set to Never.** Assets should go `MISS` -> `HIT`; HTML should stay `DYNAMIC` on repeated GETs. Confirming only the negative half cannot distinguish "HTML caching is correctly off" from "the CDN is off entirely" -- they look identical from outside. Checking that assets DO cache is what separates them, and that is precisely the check HEAD breaks.

**A `DYNAMIC` on HTML is not proof your origin is sending safe headers.** Under `Never` the edge refuses HTML regardless of what the origin sends. Read `cache-control` on the response itself: an app emitting `s-maxage=31536000` on prerendered pages is one setting change away from having authenticated HTML cached at the edge, and the `DYNAMIC` tells you nothing about that exposure.

**Generality is untested.** Verified on Railway's edge (`server: railway-hikari`). The HEAD-versus-GET asymmetry is plausible on other CDNs, but do not assume it; re-test rather than carry the conclusion across platforms.

Related: [`update-service` returns `updatedFields` echoing the REQUEST](update-service-updatedfields-echoes-request.md) and [Service source writes report "applied" and silently do not persist](service-source-write-reports-applied.md) -- the same lesson from the config side. Railway settings need verifying against observed behaviour, and the observation itself has to be the right one.
