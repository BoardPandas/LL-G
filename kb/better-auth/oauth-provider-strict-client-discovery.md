---
tech: better-auth
tags: [oauth-provider, mcp, rfc8414, rfc9728, discovery, issuer, antigravity, gemini, oauth2]
severity: high
---
# oauth-provider MCP discovery fails in strict clients: AS metadata issuer mismatch

## PROBLEM
A Better Auth `@better-auth/oauth-provider` MCP server signs in fine from lenient clients (Claude) but shows no sign-in button in strict ones (Antigravity/Gemini, Go `mcp_manager`). The client logs `auth server metadata discovery failed: no authorization server metadata found for https://<origin>`.

Cause: the RFC 9728 protected-resource metadata (usually hand-written) advertises `authorization_servers: ["https://<origin>"]` (the bare origin), but the oauth-provider's authorization-server metadata declares `issuer: "https://<origin>/api/auth"`. The plugin sets `issuer = jwtPluginOptions?.jwt?.issuer ?? ctx.context.baseURL`, and Better Auth builds `ctx.context.baseURL` as `BETTER_AUTH_URL + "/api/auth"`. RFC 8414 requires the discovered AS `issuer` to be byte-identical to the value the client looked it up by, so a strict client fetches `<origin>/.well-known/oauth-authorization-server`, sees `issuer: <origin>/api/auth`, rejects it as a mismatch, and reports "no authorization server metadata found". Lenient clients ignore the mismatch, which is why it works in some clients and not others.

## WRONG
```ts
// protected-resource metadata (RFC 9728) advertises the bare origin
res.json({
  resource: `${origin}/mcp/${provider}`,
  authorization_servers: [new URL(origin).origin], // <-- "https://host", but the AS issuer is "https://host/api/auth"
  jwks_uri: `${origin}/api/auth/jwks`,
});
// AS metadata served at /.well-known/oauth-authorization-server has issuer "https://host/api/auth"
// -> strict client: "no authorization server metadata found for https://host"
```

## RIGHT
```ts
// Advertise Better Auth's REAL issuer so the discovered AS issuer matches exactly.
res.json({
  resource: `${origin}/mcp/${provider}`,
  authorization_servers: [`${origin}/api/auth`], // matches issuer in the AS metadata
  jwks_uri: `${origin}/api/auth/jwks`,
});

// Better Auth already serves matching-issuer metadata via path-append / OIDC at:
//   ${origin}/api/auth/.well-known/oauth-authorization-server
//   ${origin}/api/auth/.well-known/openid-configuration
// For strict RFC 8414 path-INSERT clients, also mirror it at the inserted path:
app.get("/.well-known/oauth-authorization-server/api/auth", (_q, r) => proxyAuthMetadata(".well-known/oauth-authorization-server", r));
app.get("/.well-known/openid-configuration/api/auth",       (_q, r) => proxyAuthMetadata(".well-known/openid-configuration", r));
```

## NOTES
Detection: read the client's own logs (Antigravity: `%APPDATA%/Antigravity/logs/language_server.log`). Verify with curl: the `authorization_servers` in the protected-resource doc must equal the `issuer` returned by `${origin}/api/auth/.well-known/oauth-authorization-server`. A working reference is the MCP SDK's `mcpAuthRouter`, whose `issuer` equals the origin it is discovered from. Pairs with the DCR-status gotcha (registration must return 201) -- both block strict clients and surface in sequence (discovery first, then registration). Related: [oauth-provider-mcp.md], [oauth-provider-resource-verification.md].
