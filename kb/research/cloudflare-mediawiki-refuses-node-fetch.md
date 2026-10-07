---
tech: research
tags: [mediawiki, cloudflare, nodejs, fetch, undici, scraping, user-agent]
severity: medium
---
# A Cloudflare-fronted MediaWiki API refuses Node's fetch() but answers node:https

## PROBLEM
An importer for coppermind.net's `api.php` got `403 Forbidden` (Cloudflare) from Node 24's built-in
`fetch()` (undici), even with an honest identifying User-Agent and extra Accept headers. `curl` and Node's
`node:https` module, sending the same User-Agent, got `200`. The block keys on the client, not the headers, so
adding headers to `fetch()` never helps and the importer looks broken.

## WRONG
```ts
const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
// 403 Forbidden, server: cloudflare
```

## RIGHT
```ts
import { request } from "node:https";
const body = await new Promise<string>((resolve, reject) => {
  const req = request(url, { headers: { "User-Agent": UA, Accept: "application/json" } }, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    res.on("error", reject);
  });
  req.on("error", reject);
  req.end();
});
```

## NOTES
- Keep the User-Agent honest (project name and contact URL) and rate-limit (one request a second, honour
  `Retry-After`). Do not impersonate a browser: if a plain identified client is also refused, stop and ask the
  site owner.
- Check the site's licence and scraping policy first (the Coppermind is CC BY-NC-ND and needs permission).
- Related: `fandom-wiki-blocked-use-mediawiki-api.md`.
