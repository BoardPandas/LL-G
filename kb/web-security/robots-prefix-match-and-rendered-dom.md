---
tech: web-security
tags: [robots.txt, seo, ssr, spa, googlebot, rendering, search-console, x-robots-tag]
severity: high
---
# robots.txt `Disallow` is a prefix match, and Google indexes the rendered DOM: blocking a page's assets or its API calls silently de-indexes an SPA

## PROBLEM
`Disallow: /shell` was meant for one bare `/shell` page, but robots rules are PREFIX matches, so it also blocked `/shell/shell.js` and `/shell/*.css`. Googlebot rendered every SPA page blank; indexed pages fell from ~6,100 to 601 over two months as "Crawled - currently not indexed". Every response stayed HTTP 200 and nothing logged an error.

Second trap, once the JS is unblocked: Google indexes the RENDERED DOM. Server-rendered fallback HTML that the SPA deletes on boot (e.g. `#ssr-fallback` removed by the shell) only helps head tags, raw-HTML link discovery and non-JS crawlers. And the renderer obeys robots.txt for every `fetch`, so a blanket `Disallow: /api/` makes the rendered page show its error states ("Your decks could not be loaded").

Detection: Search Console > URL Inspection > Test live URL > View tested page > More info > Page resources lists "Googlebot blocked by robots.txt"; the Screenshot tab shows what Google actually indexes.

## WRONG
```text
User-agent: *
Allow: /
Disallow: /shell     # also blocks /shell/shell.js, /shell/shell.css
Disallow: /api/      # rendered views can't load their data
```

## RIGHT
```text
User-agent: *
Allow: /
Disallow: /shell$            # anchored: only the bare page
Disallow: /api/
Allow: /api/cards/stub/      # longer match wins: public read APIs the public views fetch
Allow: /api/proxy/decks/public$
```
```ts
// every /api/* response: crawlable for rendering, never indexed itself
app.use("/api/*", async (c, next) => { await next(); c.res.headers.set("X-Robots-Tag", "noindex"); });
```
Test robots with a Google-semantics matcher (longest rule wins, `*` wildcard, `$` anchor, Allow wins ties) asserting asset paths and public read APIs are allowed and per-user endpoints are not.

## NOTES
- Content Google should index must exist in the SPA's own view, not only in SSR fallback the SPA removes.
- Head tags (title, description, canonical) survive the render if the SPA never rewrites them.
- Source: BoardPandas/tcg 3.711.0.0 (cbe7f377e) and 3.711.3.0 (ed00622c3).
