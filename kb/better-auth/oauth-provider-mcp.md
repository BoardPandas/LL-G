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
      allowDynamicClientRegistration: true,        // RFC 7591 at /api/auth/oauth2/register
      allowUnauthenticatedClientRegistration: true,// REQUIRED for MCP connectors (see notes)
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

// Verify an MCP bearer token in your resource server with jose.
// The issuer is the auth base URL INCLUDING the basePath (default /api/auth),
// NOT the bare origin -- hardcoding the origin rejects every token (see notes).
import { createRemoteJWKSet, jwtVerify } from "jose";
const ISSUER = `${process.env.BETTER_AUTH_URL}/api/auth`; // e.g. https://host/api/auth
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/jwks`));
const { payload } = await jwtVerify(token, jwks, {
  issuer: ISSUER,
  audience: process.env.MCP_RESOURCE_URL, // reject tokens minted for another resource
});
```

## NOTES
- **`allowDynamicClientRegistration: true` is NOT enough for MCP connectors.** Claude.ai / ChatGPT / Claude Code connectors self-register BEFORE they hold any credentials, so you must ALSO set `allowUnauthenticatedClientRegistration: true` (defaults to false; the old `mcp()` plugin allowed it implicitly). Without it `/api/auth/oauth2/register` returns 401 and no connector can onboard.
- **The token issuer is `<origin>/api/auth`, not the bare origin.** `oauthProvider`/`jwt()` derive `iss` from the auth instance's `baseURL`, which includes the basePath (default `/api/auth`). A resource server that verifies with `issuer: "<bare origin>"` rejects every token with an issuer mismatch. Derive it from the auth instance (or hardcode `<origin>/api/auth`); the JWKS lives at `<origin>/api/auth/jwks`. Pin the token `audience` to the same `resource` URL your RFC 9728 metadata advertises (`<origin>/mcp`) so a token minted for another resource is rejected.
- `oauthProvider` auto-serves `/.well-known/oauth-authorization-server` (RFC 8414) and RFC 7591 Dynamic Client Registration, but does NOT serve `/.well-known/oauth-protected-resource` (RFC 9728). Your MCP resource server must serve that itself, advertising `resource`, `authorization_servers`, and `jwks_uri`. The RFC 9728 metadata must advertise only the resource's OWN scopes (e.g. read/write/admin), NOT the OIDC `openid` scope, or the metadata builder errors "Only the Auth Server should utilize the openid scope".
- **A custom `consentPage` has its own trap:** the page must echo the signed `oauth_query` back in the POST body to `/oauth2/consent` or it 400s with "missing oauth query". See [consent-page-oauth-query.md](consent-page-oauth-query.md).
- **Migrating an existing `mcp()` deployment:** `oauthProvider` REUSES the table names `oauthAccessToken` and `oauthConsent` from the old `mcp()` plugin with an INCOMPATIBLE shape, so the boot migration ALTERs the populated old tables and crash-loops (`column "token" contains null values`, SQLSTATE 23502). Rename the old tables aside (e.g. `*_old_mcp`) before first boot so the migration creates them fresh.
- Identity must come from the validated token only (its `sub`), never from tool arguments.
- Supersedes the older root-level discovery/expiry workarounds in [mcp-plugin-oauth.md](mcp-plugin-oauth.md), which apply to the deprecated `mcp()` plugin.
- Tables created by the provider: `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent` (plus core `user`/`session`/`account`/`verification`, org `organization`/`member`/`invitation`, and jwt `jwks`).
- Sources: https://better-auth.com/docs/plugins/oauth-provider and https://better-auth.com/docs/plugins/mcp
