---
tech: better-auth
tags: [oauth-provider, mcp, rfc8707, refresh-token, resource-indicator, audience, jwt, antigravity, gemini, offline_access]
severity: high
---
# oauth-provider refresh breaks silent re-auth with RFC 8707 resource binding

## PROBLEM
An MCP server using `@better-auth/oauth-provider` + `jwt()` with per-connector RFC 8707 audience binding appears to lose authentication every ~hour and on every client restart. Strict clients (Antigravity/Gemini) silently fall back to a full re-authorization and register a fresh DCR client every time (we saw 52 `oauthClient` rows accumulate). It looks like refresh tokens aren't issued, but they ARE: the provider DB showed 21 `oauthRefreshToken` rows (offline_access scope, 30-day expiry) being rotated.

The real failure is the refresh grant's audience binding. `createUserTokens` derives the access-token audience only from `checkResource(ctx)`, which reads `ctx.body.resource` from the CURRENT request; `handleRefreshTokenGrant` does NOT carry forward the original audience (the `oauthRefreshToken` row stores scopes, not audience). Strict clients send `resource` on the initial authorization_code exchange (so first sign-in works) but OMIT it on refresh. With no `resource`, `audience` is undefined, so `isJwtAccessToken = audience && !disableJwtPlugin` is false and the provider mints an OPAQUE (audience-less) access token instead of a JWT. The resource server verifies via JWKS with a required audience and 401s the opaque/mis-audienced token, so every refresh fails and the client loops back to full re-auth.

Separately, a refresh token is only issued at all when `offline_access` is in the GRANTED scopes (gate in `createUserTokens`: `isRefreshToken = user && scopes.includes("offline_access")`). A server whose discovery metadata advertises only resource scopes (e.g. `read write admin`) never gets a refresh token in the first place — advertise `offline_access` so strict clients request it.

## WRONG
```ts
// Resource server requires the exact per-connector audience.
await jwtVerify(token, JWKS, {
  issuer: ACCEPTED_ISSUERS,
  audience: `${baseURL}/mcp/${provider}`, // refreshed token (no `resource` -> opaque/no aud) is rejected -> 401 -> re-auth loop
});
// Auth config never defaults `resource`, so a refresh request that omits it mints an opaque token.
oauthProvider({ validAudiences, scopes: ["openid", "profile", "email", "offline_access"] });
```

## RIGHT
```ts
import { createAuthMiddleware } from "better-auth/api";

const defaultResource = baseURL; // single-connector servers: use the one /mcp resource URL instead

betterAuth({
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/oauth2/token") return;
      const body = ctx.body as Record<string, unknown> | undefined;
      if (!body || body.resource) return;             // only when the client omitted it (i.e. refresh)
      return { context: { body: { ...body, resource: defaultResource } } };
    }),
  },
  plugins: [
    jwt(),
    oauthProvider({
      validAudiences: [...connectorResources, userinfoAudience, defaultResource],
      scopes: ["openid", "profile", "email", "offline_access"], // offline_access REQUIRED for refresh tokens
    }),
  ],
});

// Resource server: accept this connector's own resource OR the default origin resource.
await jwtVerify(token, JWKS, {
  issuer: ACCEPTED_ISSUERS,
  audience: [`${baseURL}/mcp/${provider}`, baseURL],
});
```

## NOTES
Multi-connector servers that share one authorization server can't know which connector a bare refresh maps to, so they must default to a shared resource (origin) and relax the resource-server audience check to accept it (access is still gated per connector by the user's stored credentials). Single-connector servers can default `resource` to their one MCP resource URL and keep the strict per-connector audience check — no relaxation needed.

Diagnosing this requires querying the provider DB directly: count `oauthRefreshToken` rows and check rotation/`revoked`. If refresh tokens exist and rotate but sessions still drop, the audience-on-refresh binding is the culprit (not refresh issuance). Reference: the MCP SDK's `mcpAuthRouter`, or any provider that always issues refresh tokens, does not exhibit this.

Related: [oauth-provider-resource-verification.md] (same `resource` requirement, initial-request side), [oauth-provider-strict-client-discovery.md], [oauth-provider-dcr-201-status.md].
