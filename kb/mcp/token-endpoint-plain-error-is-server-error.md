---
tech: mcp
tags: [mcp, oauth, typescript-sdk, token-endpoint, refresh-token, invalid_grant]
severity: high
---
# A provider that throws plain errors makes a dead grant look like a 500

## PROBLEM
The MCP TypeScript SDK v1 token handler (`@modelcontextprotocol/sdk/server/auth/handlers/token`) only maps `OAuthError` subclasses to OAuth responses. If an `OAuthServerProvider`'s `exchangeAuthorizationCode` or `exchangeRefreshToken` throws a plain `Error` for an expired, revoked or unknown code/refresh token, the client gets `500 {"error":"server_error"}` instead of `400 invalid_grant`. Clients cannot tell a dead grant (re-authenticate) from an outage (retry), so they retry forever or show a server error instead of prompting login.

## WRONG
```ts
async exchangeRefreshToken(client, refreshToken) {
  const row = await findLiveRefresh(refreshToken);
  if (!row) throw new Error('Invalid or expired refresh token'); // -> 500 server_error
}
```

## RIGHT
```ts
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

async exchangeRefreshToken(client, refreshToken) {
  const row = await findLiveRefresh(refreshToken);
  if (!row) throw new InvalidGrantError('Invalid or expired refresh token'); // -> 400 invalid_grant
}
```

## NOTES
Import the error class from the same module build (ESM vs CJS) the router was loaded from, or `instanceof` fails and you are back to 500. If that is impractical (e.g. ESM-only under Jest), a first-party client should treat any refused refresh (400 or 500 on grant_type=refresh_token) as "log in again" and never delete credentials on that basis. Seen in SupportForge's sforge CLI, 2026-10-05.
