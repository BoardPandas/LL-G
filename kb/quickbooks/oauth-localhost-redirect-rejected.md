---
tech: quickbooks
tags: [quickbooks, intuit, oauth, redirect-uri, localhost, production, callback]
severity: medium
---
# Intuit rejects http://localhost redirect URIs for production QuickBooks apps

## PROBLEM
The Intuit Developer Portal accepts `http://localhost` redirect URIs only for development keys.
A production QuickBooks Online app rejects any `localhost` redirect, so the common "run a local
callback server on port 8000" onboarding (what the Intuit sample MCP server's `npm run auth` does)
cannot obtain a production refresh token. Contributors then reach for ngrok tunnels or a throwaway
VPS callback just to complete one handshake.

## WRONG
```
# Production app, bundled localhost auth flow -> Intuit returns redirect_uri mismatch
redirect_uri = http://localhost:8000/callback
```

## RIGHT
```ts
// Host the 3-legged callback on a real public HTTPS origin you already run, register it once
// in the Intuit app's Redirect URIs, and use the SAME value in authorize and token exchange.
const redirectUri = "https://x.boardpandas.ai/api/quickbooks/callback";
// authorize:
//   https://appcenter.intuit.com/connect/oauth2?client_id=...&response_type=code
//     &scope=com.intuit.quickbooks.accounting&redirect_uri=<redirectUri>&state=<nonce>
// callback -> exchange code at oauth.platform.intuit.com/oauth2/v1/tokens/bearer with the SAME redirectUri
```

## NOTES
The redirect URI must match byte-for-byte in the portal, the authorize request, and the token
exchange, or Intuit returns a `redirect_uri` mismatch. If you host an OAuth-capable web app
already (a dashboard, a bridge), add a small authorize/callback route pair there instead of
tunneling to localhost. See also `oauth-endpoints-sandbox-prod-realmid.md`.
