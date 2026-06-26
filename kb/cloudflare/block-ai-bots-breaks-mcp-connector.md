---
tech: cloudflare
tags: [cloudflare, bot-fight-mode, ai-bots, mcp, oauth, better-auth, waf, 403, user-agent]
severity: high
---
# "Block AI bots" silently 403s your own MCP / OAuth connector

## PROBLEM
Cloudflare's **"Block AI bots" / "AI Scrapers & Crawlers"** feature (Security -> Bots) blocks requests whose User-Agent matches a known AI crawler -- `ClaudeBot`, `Claude-User`, `anthropic-ai`, `GPTBot`, etc. -- with `403 "Your request was blocked."`. If you self-host an MCP server (or any OAuth-authenticated API) for Claude/ChatGPT behind Cloudflare, this blocks the **legitimate connector**, not just scrapers.

The failure is brutal to diagnose because it is **silent and misattributed**:
- The browser-based OAuth `authorize`/`consent` step **succeeds** -- it runs under the user's normal browser UA, so Cloudflare lets it through and a token is minted.
- The AI host's **backend** then calls your endpoints (`/.well-known/*`, `/oauth2/token`, the MCP resource URL) with its bot UA and gets 403'd **at Cloudflare's edge, before reaching your app**.
- So there is **zero trace** in your application logs (Pino/app_logs/etc.) -- nothing failed server-side.
- The AI host shows a generic message: "Authorization with the MCP server failed", "the integration rejected the credentials", or "not a valid MCP server" -- which screams OAuth/code bug but is pure edge config.

Classic tell: **"it worked before we moved behind Cloudflare / changed domains."** A bare origin (Railway/Render/Fly default host) has no Cloudflare, so it worked; the custom-domain cutover put it behind Cloudflare with AI-bot blocking on. You can `curl` the token endpoint yourself and the OAuth token validates perfectly -- because your curl uses a normal UA.

## WRONG
```bash
# Endpoint looks healthy when YOU test it (normal UA) ...
curl -s -o /dev/null -w "%{http_code}\n" https://app.example.com/api/mcp/mcp        # 401 (reaches app, just needs a token) -> looks fine
# ... so you spend hours auditing OAuth: JWKS, aud/iss, PKCE, token-exchange, scopes.
# Meanwhile the real connector (Anthropic backend UA) never reaches your app:
curl -s -o /dev/null -w "%{http_code}\n" https://app.example.com/api/mcp/mcp \
  -H "User-Agent: Claude-User/1.0"                                                  # 403 "Your request was blocked." (Cloudflare, app never sees it)
```

## RIGHT
```bash
# 1. DIAGNOSE in one line -- compare a Claude UA vs a normal UA on a public endpoint:
curl -s -o /dev/null -w "%{http_code}\n" https://HOST/.well-known/oauth-protected-resource -H "User-Agent: Claude-User/1.0"
#   403  -> Cloudflare AI-bot block (edge); the app never sees the request, no server log.
#   200  -> reached the app; look elsewhere.
# Confirm: ClaudeBot/Claude-User/anthropic-ai -> 403, but node/python-requests/browser -> 200/401.

# 2. FIX (Cloudflare config, NOT code):
#   Free plan: Security -> Bots -> turn OFF "Block AI bots"
#     (API: PUT /zones/{zone}/bot_management { "ai_bots_protection": "disabled" }
#      -- needs a token with Zone -> Bot Management: Edit; a read-only token returns 10000 auth error)
#   Pro+ (surgical): WAF -> Custom rules -> Skip rule:
#     When  (starts_with(http.request.uri.path,"/api/mcp") or
#            starts_with(http.request.uri.path,"/api/auth") or
#            starts_with(http.request.uri.path,"/.well-known"))
#     Then  Skip -> Super Bot Fight Mode / AI-bot blocking
#   (keeps AI-bot protection on the rest of the zone, exempts only the integration paths)
```

## NOTES
- The zone is at the registrable-domain level (`example.com`), not the subdomain (`app.example.com`) -- look up the apex zone.
- This is UA-signature matching: exact known-bot UAs are blocked, but a generic `"Claude/1.0"` or `"Anthropic"` string passes -- don't be fooled into thinking "it's not a UA filter."
- Same root cause hits ChatGPT connectors (`GPTBot`, `ChatGPT-User`, `OAI-SearchBot`) and any verified-bot-blocking config (Bot Fight Mode, Super Bot Fight Mode, the "Block AI Scrapers and Crawlers" managed rule).
- MCP connector traffic is user-initiated, not training-data scraping -- exempting the API paths (or the whole app subdomain) is the correct call, not a security regression.
- Real case: BoardPandas/vigilis #359 -- `app.vigilis.io` behind Cloudflare after a Railway custom-domain cutover; the entire BetterAuth OAuth + MCP server was healthy end-to-end, the only fault was the edge block.
