---
tech: mcp
tags: [mcp, streamable-http, protocol-version, versioning, backwards-compatibility, 2026-07-28]
severity: high
---
# MCP-Protocol-Version is present three revisions before the rules it appears to gate

## PROBLEM

Revision `2026-07-28` made three things mandatory on every Streamable HTTP request: the
`MCP-Protocol-Version` header, the mirrored `Mcp-Method` / `Mcp-Name` headers, and per-request
`_meta` fields (`io.modelcontextprotocol/protocolVersion`, `.../clientCapabilities`) that the
server MUST validate the headers against, rejecting a mismatch with `400` and `-32020`.

Reading that revision alone, the obvious server-side gate is "does the request carry
`MCP-Protocol-Version`?" — if it does, apply the strict rules.

**That gate is wrong, and it rejects almost every client shipping today.**
`MCP-Protocol-Version` was introduced in **2025-06-18**. The `_meta` envelope and the
`Mcp-Method` / `Mcp-Name` headers arrived three revisions later in **2026-07-28**. So a
2025-06-18 or 2025-11-25 client sends the header — correctly — and none of the rest, because its
revision never defined them. The server then answers `400` complaining about `_meta` fields that
client has never heard of.

The failure presents as **"connected, but couldn't load tools."** The OAuth handshake completes,
`initialize` succeeds, and then every single `tools/list` is refused. Nothing in the transport
log distinguishes it from a broken tool registry, because the route is `/mcp` for every call and
the JSON-RPC method is only in the body.

## WRONG

```ts
// The header's PRESENCE decides the era.
const versionHeader = headers.get('mcp-protocol-version');
const modern = versionHeader !== null;          // true for 2025-06-18 clients
const version = versionHeader ?? '2025-03-26';

if (modern) {
  // Demands params._meta['io.modelcontextprotocol/protocolVersion'] and Mcp-Method,
  // neither of which a 2025-06-18 client sends. Every tools/list -> 400.
  const mismatch = validateHeaders(headers, { method, params, meta, version });
  if (mismatch) return { status: 400, body: rpcError(id, mismatch) };
}
```

## RIGHT

```ts
// The header's VALUE decides the era. A set, not `>=`: a future revision is added
// deliberately rather than inheriting requirements by version ordering.
const REQUIRES_REQUEST_METADATA: ReadonlySet<string> = new Set(['2026-07-28']);

const versionHeader = headers.get('mcp-protocol-version');
const version = versionHeader ?? '2025-03-26';   // pre-2025-06-18 sent no header at all
const modern = REQUIRES_REQUEST_METADATA.has(version);

// `initialize` is exempt even in the modern era: 2026-07-28 has no handshake -- the
// per-request metadata is what REPLACED it -- so a request calling it is speaking the
// handshake era whatever header it sent. Transitional clients really do advertise the
// newest version they know while still opening with one.
if (modern && method !== 'initialize') {
  const mismatch = validateHeaders(headers, { method, params, meta, version });
  if (mismatch) return { status: 400, body: rpcError(id, mismatch) };
}
```

## NOTES

- **Better still: do not hand-roll the protocol.** `@modelcontextprotocol/server` v2 implements
  2026-07-28 including era classification, and `createMcpHandler(factory, { legacy: 'stateless' })`
  serves both eras. See `sdk-v2-replaces-hand-rolled-protocol.md`.
- Test both directions. A test that only asserts the modern era passes while every real client is
  refused. Assert that `2025-03-26`, `2025-06-18` and `2025-11-25` are all served **without**
  request metadata, and that `2026-07-28` is still held to the full rules.
- Related failure in the same gate: answering an unimplemented method with `404` is correct for
  2026-07-28 and fatal for older clients. See `unknown-method-404-kills-legacy-clients.md`.
- Log the JSON-RPC method, the protocol version and the client name on every `/mcp` request. The
  HTTP route is `/mcp` for everything, so without it a failing connector is an undifferentiated
  run of status codes and the method has to be inferred.
