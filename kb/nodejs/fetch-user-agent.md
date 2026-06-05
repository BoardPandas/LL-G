---
tech: nodejs
tags: [fetch, undici, user-agent, http, external-api, scryfall, silent-fallback]
severity: high
---
# Global fetch() with no User-Agent is rejected (HTTP 400) by some external APIs

## PROBLEM
Node's global `fetch` (undici) sends a default `User-Agent` that some public APIs reject. Scryfall returns **HTTP 400** for the undici/Node default UA; a proper UA returns 200. This is dangerous because the failure is usually **silent**: a `fetch` wrapper checks `res.ok`, returns `null`/`[]` on the 400, and the caller falls back to a secondary data source -- so you get **wrong/incomplete data instead of an error**.

Real case (tcg repo): `scryfall-client.ts` called `https://api.scryfall.com/cards/named?exact=` with only an `Accept` header. On Node 24 every call 400'd, `searchCard()` swallowed it and fell back to the local card mirror, which carries no double-faced `card_faces` -- so every DFC (MDFC / transform / Pathway land) imported with `back = null` ("Back-face data missing", no flip control). Every repair path (add, swap, refresh, the "Repair" button) routed through the same lookup, so none could recover. Two sibling clients in the same package had the identical latent bug, while every other Scryfall client in the repo already set a UA -- which is why only some features broke.

It is **environment-dependent**: the default UA is determined by the Node/undici version, so unchanged code can start failing after a runtime upgrade.

## WRONG
```ts
// No User-Agent. Scryfall 400s the undici default; the error is swallowed and
// the caller silently falls back to a data source missing fields (e.g. DFC backs).
const res = await fetch(`https://api.scryfall.com/cards/named?exact=${name}`, {
  headers: { Accept: "application/json" },
});
if (!res.ok) return null; // 400 -> null -> silent fallback, no error surfaced
```

## RIGHT
```ts
// Always send an explicit, identifying User-Agent to external APIs.
const USER_AGENT = "my-app/1.0 (+https://example.com)";
const res = await fetch(`https://api.scryfall.com/cards/named?exact=${name}`, {
  headers: { Accept: "application/json", "User-Agent": USER_AGENT },
});
```

## NOTES
- Reproduce: `curl -H "User-Agent: node" "https://api.scryfall.com/cards/named?exact=Sol+Ring"` returns 400, while `-H "User-Agent: my-app/1.0"` returns 200. Or run Node's global `fetch` with only an `Accept` header and observe the 400.
- Tell: if some API-backed features work and others silently return empty/null from the *same* host, diff the working vs broken clients for a missing `User-Agent` header.
- Don't swallow non-2xx silently. Log the status (and ideally surface it) before any fallback, so a UA/egress regression is visible instead of producing quietly-wrong data.
- Scryfall's API guidelines explicitly require a `User-Agent` (and an `Accept`) header. Treat a UA as mandatory for all server-side calls to public APIs, not optional.
- Sibling failure mode: this pairs with source-of-truth drift -- the silent fallback only hurt because the fallback store (local mirror) was missing fields the primary (live Scryfall) had. See the Architecture index (redundant stores / source-of-truth drift).
