---
tech: better-auth
tags: [mcp, oauth, oauth-provider, oauth2, jwt, deprecation, cli, organization, jose, rfc9728, rfc8707, cimd]
severity: high
---
# MCP OAuth server: 1.6 uses @better-auth/oauth-provider, 1.7 uses mcp() from @better-auth/mcp -- never both

## PROBLEM
The right plugin for an OAuth 2.1 MCP authorization server flipped between minor versions, and following the guidance for the wrong one is a dead end:

- **1.6.x:** the built-in `mcp()` plugin (from `better-auth/plugins`) is deprecated. Use the separate `@better-auth/oauth-provider` package with the `jwt()` plugin.
- **1.7.x:** the MCP plugin moved out of `better-auth` into its own package, `@better-auth/mcp`, built on `@better-auth/oauth-provider`. The 1.7 docs say: "`mcp()` is the OAuth provider. Do not also register a separate `oauthProvider()` plugin in the same app." For an MCP server, register `mcp()` from `@better-auth/mcp`, not `oauthProvider()`.

So "mcp() is deprecated, use oauthProvider()" is correct for 1.6 and wrong for 1.7, and a plan that lists both plugins is wrong on every version. The 1.6 setup also does not carry over: 1.7 removed `validAudiences` (see [oauth-provider-1-7-validaudiences-ignored.md](oauth-provider-1-7-validaudiences-ignored.md)), requires a `resource` option, and recommends Client ID Metadata Documents (`@better-auth/cimd`) over Dynamic Client Registration, which it never enables implicitly.

Two adjacent traps bite during the same task on 1.6: `@better-auth/cli` is versioned independently and LAGS core (1.4.21 vs 1.6.14 in mid-2026), so a matched-version pin fails to install and `auth:generate` may not know the newest plugin schema; and the organization-plugin creation hook was renamed -- `organizationCreation.afterCreate` no longer exists.

## WRONG
```ts
// 1.6.x: the old built-in plugin
import { betterAuth } from "better-auth";
import { mcp, organization } from "better-auth/plugins"; // mcp() is deprecated in 1.6

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

```ts
// 1.7.x: both plugins, plus an option 1.7 deleted
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { mcp } from "@better-auth/mcp";

export const auth = betterAuth({
  plugins: [
    jwt(),
    oauthProvider({ validAudiences: [process.env.MCP_RESOURCE_URL!] }), // removed in 1.7
    mcp({ loginPage: "/login", consentPage: "/consent", resource: process.env.MCP_RESOURCE_URL! }),
    // mcp() already IS the OAuth provider: do not register oauthProvider() beside it
  ],
});
```

## RIGHT
```ts
// 1.7.x
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";

export const auth = betterAuth({
  disabledPaths: ["/token"],                       // the jwt plugin's session-JWT route
  plugins: [
    jwt({ disableSettingJwtHeader: true }),        // required: signing key + /jwks
    mcp({
      loginPage: "/login",
      consentPage: "/consent",
      resource: "https://api.example.com/mcp",     // becomes the access token `aud`
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
  ],
});
```

```ts
// 1.6.x
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
      validAudiences: [process.env.MCP_RESOURCE_URL!], // 1.6 ONLY: removed in 1.7
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
- **Check the installed version before following any MCP guidance, this entry included.** The notes below were written against 1.6.x unless they say 1.7.
- **1.7: `mcp()` serves RFC 9728 protected-resource metadata itself**, at the well-known root and the resource-path-inserted alias. The "serve it yourself" note below is 1.6 only.
- **1.7: DCR is off unless you turn it on.** CIMD is the recommended client identity mechanism. For older clients that still need DCR, set both `allowDynamicClientRegistration: true` and `allowUnauthenticatedClientRegistration: true` on `mcp()`, and read the docs' warning first: anyone on the internet can then register a client.
- **1.7: disable the jwt plugin's `/token` route and `set-auth-jwt` header** (shown above). Session JWTs share the access tokens' signing key, so a resource server that checks only issuer and audience could accept one.
- **1.7: `mcp()` uses the OAuth Provider schema** (`oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthClientAssertion`, `oauthResource`, `oauthClientResource`). `validAudiences` is gone; resources are rows, seeded from `resource` / `resources`.
- **1.6: `allowDynamicClientRegistration: true` is NOT enough for MCP connectors.** Claude.ai / ChatGPT / Claude Code connectors self-register BEFORE they hold any credentials, so you must ALSO set `allowUnauthenticatedClientRegistration: true` (defaults to false; the old `mcp()` plugin allowed it implicitly). Without it `/api/auth/oauth2/register` returns 401 and no connector can onboard.
- **The token issuer is `<origin>/api/auth`, not the bare origin.** `oauthProvider`/`jwt()` derive `iss` from the auth instance's `baseURL`, which includes the basePath (default `/api/auth`). A resource server that verifies with `issuer: "<bare origin>"` rejects every token with an issuer mismatch. Derive it from the auth instance (or hardcode `<origin>/api/auth`); the JWKS lives at `<origin>/api/auth/jwks`. Pin the token `audience` to the same `resource` URL your RFC 9728 metadata advertises (`<origin>/mcp`) so a token minted for another resource is rejected.
- **1.6:** `oauthProvider` auto-serves `/.well-known/oauth-authorization-server` (RFC 8414) and RFC 7591 Dynamic Client Registration, but does NOT serve `/.well-known/oauth-protected-resource` (RFC 9728). Your MCP resource server must serve that itself, advertising `resource`, `authorization_servers`, and `jwks_uri`. The RFC 9728 metadata must advertise only the resource's OWN scopes (e.g. read/write/admin), NOT the OIDC `openid` scope, or the metadata builder errors "Only the Auth Server should utilize the openid scope".
- **A custom `consentPage` has its own trap:** the page must echo the signed `oauth_query` back in the POST body to `/oauth2/consent` or it 400s with "missing oauth query". See [consent-page-oauth-query.md](consent-page-oauth-query.md).
- **Migrating an existing built-in `mcp()` deployment (pre-1.7):** `oauthProvider` REUSES the table names `oauthAccessToken` and `oauthConsent` from the old `mcp()` plugin with an INCOMPATIBLE shape, so the boot migration ALTERs the populated old tables and crash-loops (`column "token" contains null values`, SQLSTATE 23502). Rename the old tables aside (e.g. `*_old_mcp`) before first boot so the migration creates them fresh.
- Identity must come from the validated token only (its `sub`), never from tool arguments.
- Supersedes the older root-level discovery/expiry workarounds in [mcp-plugin-oauth.md](mcp-plugin-oauth.md), which apply to the built-in `mcp()` plugin from `better-auth/plugins` (1.6 and earlier), not to `@better-auth/mcp`.
- Tables created by the 1.6 provider: `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent` (plus core `user`/`session`/`account`/`verification`, org `organization`/`member`/`invitation`, and jwt `jwks`).
- Sources: https://better-auth.com/docs/plugins/oauth-provider and https://better-auth.com/docs/plugins/mcp. The 1.7 claims were checked against `docs/content/docs/plugins/mcp.mdx` at tag v1.7.27 and the `better-auth` changelog for 1.7.0 (PR #9992: the MCP plugin moves to `@better-auth/mcp`; PR #9648: `validAudiences` removed).
