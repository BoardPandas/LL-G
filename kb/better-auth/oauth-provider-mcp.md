---
tech: better-auth
tags: [mcp, oauth, oauth-provider, oauth2, jwt, deprecation, cli, organization, jose, rfc9728, rfc8707]
severity: high
---
# mcp() plugin deprecated -- use @better-auth/oauth-provider for OAuth 2.1 MCP servers

## PROBLEM
As of better-auth 1.6.x the built-in `mcp()` plugin (from `better-auth/plugins`) is deprecated and will be removed. Building a new OAuth 2.1 authorization server for an MCP resource server against `mcp()` is a dead end. The replacement is the separate `@better-auth/oauth-provider` package (used with the `jwt()` plugin). Two adjacent traps bite during the same task: `@better-auth/cli` is versioned independently and LAGS core (1.4.21 vs 1.6.14 in mid-2026), so a matched-version pin fails to install and `auth:generate` may not know the newest plugin schema; and the organization-plugin creation hook was renamed -- `organizationCreation.afterCreate` no longer exists.

## WRONG
```ts
import { betterAuth } from "better-auth";
import { mcp, organization } from "better-auth/plugins"; // mcp() is deprecated

export const auth = betterAuth({
  plugins: [
    mcp({ loginPage: "/login" }),            // dead end in 1.6.x
    organization({
      organizationCreation: {                // not a real option in 1.6.x
        afterCreate: async ({ organization }) => { /* ... */ },
      },
    }),
  ],
});
// package.json: "@better-auth/cli": "^1.6.14"  // 404 — max is 1.4.21
```

## RIGHT
```ts
import { betterAuth } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";

export const auth = betterAuth({
  plugins: [
    jwt(),                                   // signs JWT access tokens (jwks table)
    oauthProvider({
      loginPage: "/login",
      consentPage: "/consent",
      scopes: ["openid", "profile", "email", "offline_access", "mcp:read", "mcp:write"],
      allowDynamicClientRegistration: true,  // RFC 7591 at /api/auth/oauth2/register
      validAudiences: [process.env.MCP_RESOURCE_URL!], // RFC 8707 audience binding
    }),
    organization({
      organizationHooks: {                   // 1.6.x hook name
        afterCreateOrganization: async ({ organization, user, member }) => { /* seed */ },
      },
    }),
  ],
});
// package.json — pin the CLI on its OWN range (it lags core):
//   "better-auth": "^1.6.14",
//   "@better-auth/oauth-provider": "^1.6.14",
//   "@better-auth/cli": "^1.4.21"

// Verify an MCP bearer token in your resource server with jose:
import { createRemoteJWKSet, jwtVerify } from "jose";
const jwks = createRemoteJWKSet(new URL(`${process.env.BETTER_AUTH_URL}/api/auth/jwks`));
const { payload } = await jwtVerify(token, jwks, {
  issuer: process.env.BETTER_AUTH_URL,
  audience: process.env.MCP_RESOURCE_URL, // reject tokens minted for another resource
});
```

## NOTES
- `oauthProvider` auto-serves `/.well-known/oauth-authorization-server` (RFC 8414) and RFC 7591 Dynamic Client Registration, but does NOT serve `/.well-known/oauth-protected-resource` (RFC 9728). Your MCP resource server must serve that itself, advertising `resource`, `authorization_servers`, and `jwks_uri`.
- Identity must come from the validated token only (its `sub`), never from tool arguments.
- Supersedes the older root-level discovery/expiry workarounds in [mcp-plugin-oauth.md](mcp-plugin-oauth.md), which apply to the deprecated `mcp()` plugin.
- Tables created by the provider: `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent` (plus core `user`/`session`/`account`/`verification`, org `organization`/`member`/`invitation`, and jwt `jwks`).
- Sources: https://better-auth.com/docs/plugins/oauth-provider and https://better-auth.com/docs/plugins/mcp
