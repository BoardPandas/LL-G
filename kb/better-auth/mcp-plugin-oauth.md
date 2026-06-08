---
tech: better-auth
tags: [mcp, oauth, plugin, well-known, sessions, tokens, deprecated]
severity: high
---
# mcp() plugin: OAuth lives under /api/auth, mirror /.well-known to root; getMcpSession ignores expiry

## PROBLEM
> DEPRECATED APPROACH. The built-in `mcp()` plugin (`better-auth/plugins`) is
> deprecated as of better-auth 1.6.x and will be removed. For any NEW MCP OAuth
> server use `@better-auth/oauth-provider` + `jwt()` instead -- see
> [oauth-provider-mcp.md](oauth-provider-mcp.md). This entry is retained only for
> maintaining EXISTING `mcp()` integrations; do not build new ones against it.

The `mcp()` plugin makes a server connectable from Claude's "Add custom connector"
(OAuth) dialog, but two things bite:
1. It registers discovery + endpoints under the auth basePath
   (`/api/auth/.well-known/oauth-authorization-server`, `/api/auth/mcp/{authorize,token,register}`),
   yet MCP clients fetch the metadata at the **domain root** `/.well-known/oauth-*`.
   Without a root mirror, discovery 404s and the connector fails to register.
2. `auth.api.getMcpSession()` returns the access-token row WITHOUT checking expiry,
   so an expired token still validates.

## WRONG
```ts
// Only the plugin endpoints exist; nothing at the root well-known paths.
// Claude GET https://host/.well-known/oauth-authorization-server -> 404 -> connector fails.

const session = await auth.api.getMcpSession({ headers });
if (session) authorize(session.userId); // accepts EXPIRED tokens
```

## RIGHT
```ts
// Mirror discovery to the root (custom server / framework route):
app.get("/.well-known/oauth-authorization-server", async (_q, res) =>
  res.json(await auth.api.getMcpOAuthConfig({ headers: new Headers() })));
app.get(/^\/\.well-known\/oauth-protected-resource(\/.*)?$/, async (_q, res) =>
  res.json(await auth.api.getMCPProtectedResource({ headers: new Headers() })));

const session = await auth.api.getMcpSession({ headers });
if (session?.userId &&
    new Date(session.accessTokenExpiresAt).getTime() > Date.now()) {
  authorize(session.userId);
}
// On unauthenticated MCP requests, reply 401 with the challenge that starts the flow:
//   WWW-Authenticate: Bearer resource_metadata="https://host/.well-known/oauth-protected-resource"
```

## NOTES
Consent is only required when the request carries `prompt=consent`; otherwise
`/authorize` redirects straight back with the code -- no consent page needed.
Unauthenticated authorize requests bounce to your `loginPage` and resume
automatically via an after-hook + the `oidc_login_prompt` cookie once a session
exists. The MCP SDK's `StreamableHTTPServerTransport` needs Node `req`/`res`, so run
the gateway in a custom server (Express), not Next App-Router route handlers (Web
Request/Response).

Superseded by [oauth-provider-mcp.md](oauth-provider-mcp.md) (the
`@better-auth/oauth-provider` + `jwt()` successor). Note the consent model differs:
with `oauth-provider` an explicit consent page is the norm and it has its own gotcha
([consent-page-oauth-query.md](consent-page-oauth-query.md)), unlike `mcp()` where
consent only appears on `prompt=consent`.
