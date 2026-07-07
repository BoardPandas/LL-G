---
tech: quickbooks
tags: [quickbooks, intuit, oauth, sandbox, production, realmid, token-exchange]
severity: medium
---
# QuickBooks OAuth: same endpoints for sandbox/prod, and realmId comes in the callback

## PROBLEM
Two easy wrong assumptions when wiring the QuickBooks Online OAuth code flow:
1. That sandbox and production use different OAuth endpoints. They do NOT — the authorize and
   token endpoints are identical; only the runtime Accounting API base differs
   (`sandbox-quickbooks.api.intuit.com` vs `quickbooks.api.intuit.com`). Branching your OAuth URLs
   on environment is wasted code and a source of mismatch bugs.
2. That the company id (`realmId`) comes back in the token response. It does NOT — `realmId`
   arrives as a query parameter on the redirect to your callback, alongside `code` and `state`.
   Reading it from the token JSON yields `undefined`, so you store a tokenized-but-companyless
   credential that fails every API call.

## WRONG
```ts
const tokenUrl = env === "production"
  ? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"   // same URL...
  : "https://sandbox.oauth.platform.intuit.com/...";               // ...this host doesn't exist
const { access_token, realmId } = await exchange(code);            // realmId is undefined
```

## RIGHT
```ts
// One set of OAuth endpoints regardless of environment:
const AUTHORIZE = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN     = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// realmId comes from the callback query, not the token body:
const params  = new URL(req.url).searchParams;
const code    = params.get("code");
const realmId = params.get("realmId");          // <-- here
const token   = await exchangeCodeForTokens(code);   // -> refresh_token, access_token
store({ refreshToken: token.refresh_token, realmId });
```

## NOTES
Token exchange is `POST` to the bearer endpoint with `Authorization: Basic base64(clientId:clientSecret)`,
`Content-Type: application/x-www-form-urlencoded`, body
`grant_type=authorization_code&code=...&redirect_uri=...`. Environment only selects the API base
the runtime client uses afterward. See also `oauth-localhost-redirect-rejected.md`.
