---
tech: web-security
tags: [csp, content-security-policy, security-headers, style-src, script-src, connect-src, response-headers, server-rendered, unstyled-page, hono, cloudflare-workers, testing]
severity: high
---
# CSP belongs to the response, not the template: a page rendered by one layout and served with another route's header map silently loses its own stylesheet and scripts

## PROBLEM
The moment an app has **more than one response-header map** — signed-out pages vs. authenticated app vs. an embedded/consent view — the *template* and the *headers* become two independent choices made at each route, and nothing connects them. No type error, no lint, no startup check. A route can render exactly the right HTML and send it in an envelope whose CSP forbids the very assets that HTML references.

The browser fetches the document (200), parses it (fine), then refuses the subresources the policy does not name. What breaks depends on which directive is missing, and **none of it raises a server-side error**:

| Missing from the served map | What the user sees |
|---|---|
| `style-src 'self'` | External stylesheet blocked → page renders as **unstyled default-serif HTML** |
| the page's `script-src` hash | Inline module never executes → a **button that does nothing** |
| `connect-src` (with `script-src` correct) | Script runs, its `fetch`/XHR is refused → the **same dead button, one layer deeper** |
| `img-src` | Logo/favicon missing (and a white-on-dark logo on a now-white page is invisible rather than broken-looking) |

Why it is brutal to diagnose:

- **The page is 200 with byte-perfect markup.** View-source is correct, the `<link href>` is correct, and fetching that href directly returns the CSS with the right `Content-Type`. Every server-side signal says healthy.
- **It affects exactly one route**, which immediately falsifies the first hypothesis. "The stylesheet is broken" cannot be true — every other page is styled by the same sheet.
- **Tests pass on both sides of the gap.** A test asserting `PANEL_HEADERS["Content-Security-Policy"]` contains `style-src 'self'` passes: the map *is* correct, it is just not the one this route sends. A test asserting the rendered HTML contains the `<link>` passes: the markup *is* correct. Neither pairs a rendered document with the header that actually shipped with it, so 100% of the assertions are green while the page is broken in production.
- **Server-side test harnesses do not enforce CSP.** `SELF.fetch()`, supertest, MSW, `app.request()` all hand you the body; nothing applies the policy. Only a real browser does. This is not a gap you can close by adding more of the tests you already have.
- **The only error message is in the user's browser console**, not in your logs, not in your APM. On an internal admin screen nobody opens DevTools on, it ships and stays shipped.
- **The visual symptom points at the wrong subsystem.** Unstyled HTML reads as a CSS build failure, a bad asset deploy, or a cache problem. Security headers are the last place anyone looks.
- **`style-src 'unsafe-inline'` does not cover external stylesheets** — only `<style>` blocks and `style=` attributes. So the broken page still applies its handful of inline styles and looks *merely unstyled* rather than obviously catastrophic, which reinforces the "CSS cascade problem" misdiagnosis.
- **Content-addressed asset URLs remove the last server-side clue.** With `/app-<hash>.css` a path mismatch would 404 and show up in logs; a CSP block never reaches the server at all.

The root cause is structural, not a typo: a shared `html()`/`render()` helper that defaults to *one* header map, used by a route whose page belongs to a *different* one.

## WRONG
```ts
// headers.ts — two correct maps for two different surfaces.
export const PUBLIC_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // Signed-out pages inline their styles and run no JS.
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'",
};

export const APP_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // The app links an external sheet and runs hash-allowlisted inline modules.
  "Content-Security-Policy":
    `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src ${HASHES}; ` +
    "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

// index.ts — the convenience helper picks a default, and the default is a landmine.
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: PUBLIC_HEADERS });

app.get("/signin",      () => html(signInPage()));        // correct
app.get("/connections", async (c) => {
  // appShell() links /app-<hash>.css. PUBLIC_HEADERS has no `style-src 'self'`.
  // Browser: "Refused to load the stylesheet ... violates the following CSP directive".
  // Server: 200. Tests: green. Screen: unstyled wall of text.
  return html(connectionsPage(await load(c)));            // <-- wrong envelope
});
```

```ts
// The two tests that were supposed to protect this. Both pass, forever.
it("the shell links the path the route serves", () => {
  expect(appShell({ ... })).toContain(`href="${CSS_PATH}"`);   // markup correct ✓
});
it("the app CSP allows the external sheet", () => {
  expect(APP_HEADERS["Content-Security-Policy"]).toContain("style-src 'self'"); // map correct ✓
});
// Neither one ever asks: did THIS ROUTE send THAT MAP?
```

## RIGHT
```ts
// 1. STRUCTURAL FIX: make the layout own its headers so the two cannot be chosen
//    separately. A route can no longer pair the app shell with the public CSP,
//    because it never names a header map at all.
export function appShell(input: ShellInput): { body: string; headers: HeadersInit } {
  return { body: `<!doctype html>...<link rel="stylesheet" href="${CSS_PATH}">...`,
           headers: APP_HEADERS };
}

app.get("/connections", async (c) => {
  const { body, headers } = connectionsPage(await load(c));   // headers come WITH the page
  return new Response(body, { headers });
});

// If a big refactor is not on the table, at minimum delete the defaulted helper so
// every route states its map explicitly and `grep` can audit them:
//   -const html = (b) => new Response(b, { headers: PUBLIC_HEADERS });
//   +return new Response(body, { headers: APP_HEADERS });
```

```ts
// 2. THE TEST THAT ACTUALLY CATCHES IT: walk every page route and pair what the
//    response RENDERED with the header that came WITH that response. This is the
//    only shape that fails on a wrong-envelope bug.
it("every screen's own CSP permits the stylesheet it links", async () => {
  const cookie = await sessionCookie();
  for (const path of ["/", "/new", "/connections", "/log", "/people", "/profile"]) {
    const res  = await SELF.fetch(`https://app.example${path}`, { headers: { Cookie: cookie } });
    const link = (await res.text()).match(/<link rel="stylesheet" href="([^"]+)"/);
    expect(link, `${path} renders no stylesheet link — still a panel screen?`).not.toBeNull();

    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp, `${path} serves a CSP that blocks its own stylesheet`).toMatch(/style-src[^;]*'self'/);
  }
});

// 3. Same shape for inline scripts: hash the RENDERED bytes and require the response's
//    OWN header to name that hash. A hash constant that is correct but lives in a map
//    this route never sends is the identical bug.
it("every inline script is permitted by its own response's CSP", async () => {
  const res    = await SELF.fetch("https://app.example/consent", { headers: { Cookie: cookie } });
  const csp    = res.headers.get("content-security-policy") ?? "";
  for (const [, src] of (await res.text()).matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    expect(csp).toContain(`'sha256-${await sha256(src)}'`);
  }
});

// 4. And for anything that script calls — allowing a script to RUN is not allowing it
//    to DO anything. `default-src 'none'` with no connect-src = it executes and every
//    fetch is refused.
for (const url of [...script.matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1])) {
  expect(csp, `nothing permits fetch(${url})`).toMatch(/connect-src[^;]*'self'/);
}
```

```bash
# 5. Zero-tooling triage against the DEPLOYED site: diff the broken page's policy
#    against a working sibling's. The offending directive is usually the only delta.
csp() { curl -s -o /dev/null -D - -H "Cookie: $C" "$1" | grep -i '^content-security-policy:'; }
diff <(csp https://app.example/) <(csp https://app.example/connections)
# < ... style-src 'self' 'unsafe-inline'; script-src 'sha256-...'; connect-src 'self' ...
# > ... style-src 'unsafe-inline'; img-src 'self' ...          <-- no 'self' -> sheet blocked
```

## NOTES
- **Symptom → cause shortcut:** *one* page is unstyled while its siblings are fine, **and** the CSS URL returns 200 when you open it directly. That combination is this bug and essentially nothing else. Open DevTools → Console and look for `Refused to load the stylesheet '…' because it violates the following Content Security Policy directive`. Then `diff` that page's response CSP against a working page's. Thirty seconds once you know to look; a day if you start from "the CSS is broken."
- **Every directive you omit falls back to `default-src`.** With a strict `default-src 'none'` base, each header map silently forbids every subresource class it forgot to enumerate — so the maps drift apart as one surface gains a feature (an external sheet, an XHR, a `data:` image) and the others do not. The stricter the base, the sharper this trap.
- **`frame-ancestors` has no `default-src` fallback**, so a map that looks locked down by `default-src 'none'` still permits framing until you name it. Different bug, same "the base map does not mean what it looks like" root.
- **Do not fix this by widening the public map.** The signed-out pages are the anti-phishing surface and the ones an unauthenticated stranger can reach; loosening them to make an authenticated screen work moves the blast radius the wrong way. Send the right map instead.
- **Prefer one map per *surface*, chosen by the layout**, over one map per *route*, chosen by hand. The number of routes only grows, and every new one is another chance to pick the wrong envelope.
- **This is a superset of the "hash is correct but in the wrong header" bug.** If you allowlist inline scripts by SHA-256, a hash constant can be perfectly computed, perfectly maintained, and completely inert because the route serving that script sends a different map. The script silently never runs; whatever it powers is a dead control with no error anywhere.
- Framework-agnostic — Hono, Express, Fastify, Next.js route handlers, Go, Rails. Anywhere response headers are chosen per-route rather than derived from the view.
- **Related:** [`Referrer-Policy: no-referrer` also nulls `Origin` on form POSTs](referrer-policy-nulls-origin-on-form-post.md) — the same family, where individually-correct security headers combine into a silent break, and `curl`/unit tests cannot reproduce it.
- Real case: BoardPandas/Broadside, **twice**. First the OAuth consent page — rendered through the signed-out `page()` helper, so its `script-src` hash lived in `PANEL_HEADERS`, a map that route never sent; the Connect button did nothing and the entire OAuth flow terminated there. It then shipped broken a *second* time after that fix, because the now-executing script's `fetch` had no `connect-src`. Later the Connections screen rendered through the panel shell but returned via the signed-out `html()` helper, so `style-src` lacked `'self'` and the screen shipped as unstyled default-serif HTML with an invisible white-on-white logo. Two pre-existing tests covered the stylesheet — one on the map, one on the markup — and both were green the whole time. Fixed in 0.22.2 by sending `PANEL_HEADERS` and adding the per-route render/header pairing test above.
