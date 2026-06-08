---
tech: better-auth
tags: [oauth-provider, oauth2, mcp, jwt, jwks, resource-server, rfc8707, access-token, audience, issuer, verifyAccessToken]
severity: high
---
# @better-auth/oauth-provider resource server rejects every token: opaque tokens + wrong JWKS/issuer derivation

## PROBLEM
After standing up an `@better-auth/oauth-provider` auth server and verifying access tokens on the resource side with `oauthProviderResourceClient(auth).verifyAccessToken`, an MCP connector (Claude.ai, etc.) authorizes successfully -- login, consent, code exchange all succeed -- but then EVERY resource call 401s and the client reports "your account was authorized but the integration rejected the credentials, so the connection was reverted." This is two coupled bugs, both on the token-verification path that discovery-only curl checks never exercise (you need a real issued token to hit them):

1. **The provider only mints a JWT access token when the token request carries an RFC 8707 `resource` parameter.** Internally `isJwtAccessToken = audience && !disableJwtPlugin`, and `audience` comes solely from `ctx.body.resource` on `/oauth2/token`. A client that omits `resource` (Claude.ai's MCP flow does) gets an OPAQUE random-string token. A resource server doing local JWKS verification can't validate an opaque token at all.

2. **`oauthProviderResourceClient(auth)` derives the JWKS URL and expected issuer from the RAW `auth.options`, not the resolved context.** It computes `jwksUrl = auth.options.baseURL + (auth.options.basePath ?? "") + "/jwks"` and `issuer = jwtPlugin.jwt.issuer ?? auth.options.baseURL`. If you pass the bare origin as `baseURL` and leave `basePath` at its default (so the RAW option is `undefined`), it builds `https://host/jwks` (a 404) and expects issuer `https://host` -- but the provider actually serves JWKS at `https://host/api/auth/jwks` and signs tokens with `iss = https://host/api/auth` (baseURL + basePath). So even a valid JWT fails with "Jwks failed: Not Found", and would also fail the issuer check. Passing the `auth` instance does NOT make this correct (a common misconception -- it only fixes `getProtectedResourceMetadata`, not `verifyAccessToken`).

Net: opaque tokens can't be verified, and JWTs are verified against a 404 JWKS and the wrong issuer. The fix needs BOTH halves.

## WRONG
```ts
// auth.ts -- nothing forces a JWT; clients that omit `resource` get opaque tokens.
export const auth = betterAuth({
  baseURL: "https://host",                 // bare origin; basePath left default
  plugins: [jwt(), oauthProvider({ validAudiences: ["https://host/mcp"], /* ... */ })],
});

// resource verify -- relies on the client's broken JWKS/issuer derivation.
const client = createAuthClient({ baseURL: "https://host", plugins: [oauthProviderResourceClient(auth)] });
await client.verifyAccessToken(token, { verifyOptions: { audience: "https://host/mcp" } });
// -> opaque token: not a JWT, fails. JWT: "Jwks failed: Not Found" (fetches https://host/jwks, 404),
//    and issuer mismatch (expects https://host, token iss is https://host/api/auth).
```

## RIGHT
```ts
// 1) Force the JWT path: default the RFC 8707 `resource` when the client omits it,
//    via a top-level before-hook on the token endpoint (ctx.path === "/oauth2/token").
import { createAuthMiddleware } from "better-auth/api";
export const auth = betterAuth({
  baseURL: "https://host",
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/oauth2/token") return;
      const body = ctx.body as Record<string, unknown> | undefined;
      if (body && (body.resource == null || body.resource === "")) {
        body.resource = "https://host/mcp";   // a value in validAudiences
      }
    }),
  },
  plugins: [jwt(), oauthProvider({ validAudiences: ["https://host/mcp"], /* ... */ })],
});

// 2) Pin jwksUrl + issuer explicitly at the verify call -- do NOT trust the
//    client's baseURL/basePath derivation. The provider mounts under basePath,
//    so issuer is <origin>/api/auth and JWKS is <origin>/api/auth/jwks.
await client.verifyAccessToken(token, {
  jwksUrl: "https://host/api/auth/jwks",
  verifyOptions: { audience: "https://host/mcp", issuer: "https://host/api/auth" },
});
// Confirm against the live discovery doc: GET /.well-known/oauth-authorization-server
// shows the real `issuer` and `jwks_uri`; curl the jwks_uri and expect 200.
```

## NOTES
- **Diagnose by logging the failure** instead of swallowing it. `verifyAccessToken` throwing is easy to `catch -> return null`, which hides everything. Log the token's segment count (`token.split(".").length`: 3 = JWT, 1 = opaque) and the error message. "Jwks failed: Not Found" = wrong JWKS URL; "unexpected iss"/audience errors = wrong issuer/audience; segments=1 = opaque token (bug #1).
- The token's `iss` and the JWKS path both include Better Auth's basePath (default `/api/auth`). The bare origin is wrong for both. If you ever change basePath, change these too.
- This is the same-process case (auth server and resource server in one app). Even so, prefer pinning explicit values over the resource client's derivation.
- Related entries in this cluster: [oauth-provider-mcp.md](oauth-provider-mcp.md) (migration off the deprecated mcp() plugin; also notes `allowUnauthenticatedClientRegistration` and the issuer=origin/api/auth gotcha) and [consent-page-oauth-query.md](consent-page-oauth-query.md) (a custom consent page must echo `oauth_query`). The full connect flow has at least three independent failure points -- consent submission, token format, and token verification -- so test the WHOLE flow with a real client, not just curl on discovery.
- Verified against `@better-auth/oauth-provider` + `better-auth` 1.6.14.
