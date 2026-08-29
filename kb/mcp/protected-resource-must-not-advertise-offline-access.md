---
tech: mcp
tags: [mcp, oauth, rfc9728, protected-resource-metadata, scopes, offline_access, www-authenticate]
severity: medium
---
# A protected resource must not advertise offline_access

## PROBLEM

When you serve RFC 9728 protected-resource metadata for an MCP server, the obvious `scopes_supported`
is whatever the authorization server accepts — for an MCP connector that is
`openid profile email offline_access`, because those are the only scopes connectors ever request.

Two of those four must not appear in **resource** metadata:

- **`openid`** is an authentication scope belonging to the authorization server. Listing it in
  resource metadata makes strict clients treat the endpoint as an identity provider it is not.
- **`offline_access`** governs whether the *client* receives a refresh token. It is a property of
  the client's relationship with the AS, not a requirement of reaching this resource. The MCP
  authorization spec says a protected resource **SHOULD NOT** advertise it, in either
  `scopes_supported` or the `WWW-Authenticate` challenge.

Advertising them is not a hard failure, which is why it survives review: discovery still resolves
and connectors still work. It quietly misinforms clients about what the resource requires, and
`scopes_supported` is defined to mean *the minimal set needed for basic functionality*.

The same 401 challenge is also where a **`scope` parameter SHOULD** appear and usually does not.
Without it a client falls back to requesting everything in `scopes_supported`, which is the opposite
of least privilege.

## WRONG

```ts
// Everything the AS accepts, echoed into resource metadata.
app.get('/.well-known/oauth-protected-resource', (c) => c.json({
  resource: mcp.resource,
  authorization_servers: [mcp.issuer],
  jwks_uri: mcp.jwksUrl,
  scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
}));

// Challenge with no scope hint: the client requests all of scopes_supported.
function challenge(mcp) {
  return `Bearer realm="${mcp.resource}", error="invalid_token", ` +
         `resource_metadata="${base}/.well-known/oauth-protected-resource"`;
}
```

## RIGHT

```ts
app.get('/.well-known/oauth-protected-resource', (c) => c.json({
  resource: mcp.resource,
  authorization_servers: [mcp.issuer],   // full issuer path, not the bare origin
  jwks_uri: mcp.jwksUrl,
  bearer_methods_supported: ['header'],
  // The minimal set needed to reach THIS resource. No `openid` (an AS
  // authentication scope), no `offline_access` (a client/AS refresh concern).
  scopes_supported: ['profile', 'email'],
}));

function challenge(mcp, error) {
  const parts = [`Bearer realm="${mcp.resource}"`];
  if (error) parts.push(`error="${error}"`);
  parts.push('scope="profile email"');   // SHOULD: tells the client what to ask for
  parts.push(`resource_metadata="${base}/.well-known/oauth-protected-resource"`);
  return parts.join(', ');
}
```

## NOTES

- `authorization_servers` must be **byte-identical** to the AS metadata's `issuer`. If the AS mounts
  under a base path (Better Auth defaults to `/api/auth`), the bare origin will fail strict RFC 8414
  clients — see `better-auth/oauth-provider-strict-client-discovery.md`.
- The `WWW-Authenticate` challenge is what makes "paste a URL" work at all: a client with no
  credential POSTs, reads `resource_metadata` from the 401, and starts discovery. Without the header
  it has a 401 and nowhere to go, which presents as a server that refuses to connect and never
  mentions signing in.
- Only send the challenge for **authentication** failures. A suspended account or a session with no
  active tenant cannot be fixed by getting a fresh token, so a challenge there loops the client
  through authorization forever. Answer those `403` with no challenge.
- `offline_access` still matters on the **client** side: it must be in the granted scopes for a
  refresh token to exist. That is a different statement from advertising it as a resource
  requirement.
