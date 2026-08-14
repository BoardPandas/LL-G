---
tech: web-security
tags: [csrf, referrer-policy, origin, sec-fetch-site, fetch-metadata, security-headers, forms, 403, hono, cloudflare-workers, better-auth]
severity: high
---
# `Referrer-Policy: no-referrer` also nulls `Origin` on form POSTs, so an Origin-based CSRF guard refuses your own site

## PROBLEM
`Referrer-Policy: no-referrer` does **not** only suppress the `Referer` header. Per the Fetch standard's "append a request `Origin` header" algorithm, a **navigational (non-CORS) POST** — an ordinary `<form method="post">` submission — from a document with that policy is sent with **`Origin: null`**:

```
If request's method is neither GET nor HEAD, then:
  If request's mode is not "cors", then switch on request's referrer policy:
    "no-referrer" -> Set serializedOrigin to `null`.
```

So the moment you pair two individually-correct hardenings —

- `Referrer-Policy: no-referrer` on your HTML responses (a privacy header), and
- a CSRF guard that accepts only `Origin === "https://your.host"` (a security header check)

— **every form on your own site starts failing**, on every browser, permanently. Not a race, not intermittent: 100% of state-changing requests.

Why it is brutal to diagnose:
- **The two changes usually ship in the same "security hardening" commit**, so neither looks like the culprit, and each one reviews as obviously correct in isolation.
- **The error message points at the attacker, not at you.** Whatever you render for a refused cross-site POST ("that request did not come from this site") reads as a real attack or a browser quirk, never as "our own privacy header did this."
- **`curl` cannot reproduce it.** You set `Origin` by hand and it passes; the origin check looks healthy from every angle you test it from. Only a real browser form submission fails.
- **Unit tests do not catch it** for exactly the same reason: tests construct `Request` objects with an explicit `Origin`, which is not what a browser sends.
- **GET-only flows keep working**, so the app looks alive. OAuth sign-in (redirect GETs) succeeds while magic-link/password confirm POSTs die — so you can still log in and browse, and conclude the auth system is fine.
- `Origin: null` is a *present* value that does not match, so guards written as `if (origin === null) return true; return origin === EXPECTED;` — deliberately allowing absent-Origin non-browser callers — refuse it. The "allow absent" branch you wrote for `curl` does not cover it.

Same trap applies to `Referrer-Policy: same-origin` **if** the POST is cross-origin, and to the `strict-origin*` policies on an HTTPS→HTTP downgrade, which null the origin under the same algorithm.

## WRONG
```ts
// headers.ts — a privacy hardening, correct in isolation
export const HTML_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",   // <-- also strips Origin from every form POST
};

// csrf.ts — a CSRF hardening, correct in isolation
export function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;          // absent = non-browser caller (curl), allow
  return origin === "https://control.example";
}

// Real browser form POST arrives as Origin: "null"  ->  not absent, does not match  ->  403.
// Every write path in the product is dead: create, publish, delete, role change,
// sign-out, and the confirm step of magic-link sign-in.
```

```bash
# Why you do not catch it: curl sends exactly what you tell it to.
curl -sX POST -H "Origin: https://control.example" https://control.example/probe   # 404 -> "guard is fine"
curl -sX POST -H "Origin: https://evil.example"    https://control.example/probe   # 403 -> "guard works"
# Neither of these is what Chrome sends from your own page. Chrome sends Origin: null.
```

## RIGHT
```ts
// 1. Check Sec-Fetch-Site FIRST. It is a forbidden header name (no page can set it),
//    it is unaffected by referrer policy, and it answers the question directly.
export function originAllowed(request: Request): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null) return site === "same-origin" || site === "none";
  //  same-origin = our own form. none = user-initiated (typed URL, bookmark).
  //  cross-site  = the attack.  same-site = a sibling subdomain, which has no business
  //                POSTing to the host that holds the session cookie -> refuse.

  // 2. Origin only as a fallback, for callers that send no fetch metadata.
  const origin = request.headers.get("Origin");
  if (origin === null) return true;              // non-browser caller
  return origin === "https://control.example";   // Origin: null still refused here
}

// 3. Fix the root cause too, so the fallback path is not silently broken for any
//    client without Sec-Fetch-Site (Safari < 16.4). `same-origin` sends nothing
//    cross-origin either, so the privacy property that motivated `no-referrer` holds.
export const HTML_HEADERS = { "Referrer-Policy": "same-origin" };
```

```bash
# 4. Verify against the DEPLOYED origin with the header combos a browser actually sends.
probe() { printf "%-46s -> " "$1"; shift; curl -s -o /dev/null -w "%{http_code}\n" -X POST "$@" https://HOST/__probe-does-not-exist; }
probe "own form (Origin: null, same-origin)" -H "Origin: null" -H "Sec-Fetch-Site: same-origin"  # 404 = allowed
probe "attacker (Origin: null, cross-site)"  -H "Origin: null" -H "Sec-Fetch-Site: cross-site"   # 403 = refused
probe "sibling subdomain (same-site)"        -H "Sec-Fetch-Site: same-site"                      # 403 = refused
probe "foreign origin, no fetch metadata"    -H "Origin: https://evil.example"                   # 403 = refused
probe "non-browser caller (no headers)"                                                          # 404 = allowed
# POSTing a path that does not exist keeps this read-only: 403 = guard refused,
# 404 = guard passed and routing took over. Nothing is mutated either way.
```

```ts
// 5. Regression-test what a BROWSER sends, not what you find convenient to construct,
//    and pin the header so the next privacy tightening cannot re-break CSRF.
it("allows the app's own form POST, which arrives as Origin: null", async () => {
  const res = await SELF.fetch(new Request("https://control.example/some-form", {
    method: "POST",
    headers: { Origin: "null", "Sec-Fetch-Site": "same-origin" },
  }));
  expect(res.status).not.toBe(403);
});

it("no page carrying a form may send Referrer-Policy: no-referrer", () => {
  for (const h of [HTML_HEADERS, PANEL_HEADERS]) expect(h["Referrer-Policy"]).toBe("same-origin");
});
```

## NOTES
- **Symptom → cause shortcut:** if every POST in a server-rendered app 403s on a CSRF/origin check while every GET works, open DevTools → Network → the failed request → Request Headers and look for `Origin: null`. Then grep your response headers for `no-referrer`. That is the whole diagnosis, and it takes 30 seconds once you know to look.
- **`Sec-Fetch-Site` is a forbidden header name**, so `fetch()`/`XMLHttpRequest` cannot set it and no attacker page can forge it. Support: Chrome 76+, Firefox 90+, Safari 16.4+. Keep the `Origin` fallback for anything older and for non-browser callers.
- **Refuse `same-site`, not just `cross-site`.** A sibling hostname under the same registrable domain is a different origin; if it can be taken over (preview deploys on `*.workers.dev`, a marketing subdomain, a stale CNAME), `same-site` is an attack path into the host holding your session cookie.
- **Do not "fix" this by allowing `Origin: null` unconditionally.** A sandboxed iframe (`<iframe sandbox>` without `allow-same-origin`) posts `Origin: null`, and that is exactly the caller the guard exists to stop.
- `SameSite=Lax` cookies do **not** cover login CSRF, which is why guards like this exist on sign-in confirm routes at all: SameSite governs whether a cookie is *sent*, and a sign-in confirm route needs none — it *sets* one.
- Framework-agnostic. Reproduces on any server-rendered stack that sets `no-referrer` and checks `Origin`: Hono, Express, Fastify, Next.js server actions, Go, Rails.
- Real case: BoardPandas/Broadside — a security scan added the origin guard and `frame-ancestors`/`Referrer-Policy` hardening in one commit. Every write in the control panel (invite, publish, role change, hard delete, upload, sign-out) plus the magic-link confirm step 403'd for a full day; Google/Microsoft sign-in kept working because it is all GETs, which masked it. Fixed in 0.22.1 by the `Sec-Fetch-Site`-first check plus `Referrer-Policy: same-origin`.
