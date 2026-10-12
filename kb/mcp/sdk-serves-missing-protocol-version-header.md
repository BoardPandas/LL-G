---
tech: mcp
tags: [mcp, sdk, streamable-http, protocol-version, headers, 2026-07-28, conformance]
severity: high
---
# SDK 2.0.0 serves a 2026-07-28 request that omits `MCP-Protocol-Version`

## PROBLEM
Revision 2026-07-28 requires the `MCP-Protocol-Version` header on every POST. `@modelcontextprotocol/server` 2.0.0 classifies a request by its body's `_meta` envelope (`io.modelcontextprotocol/protocolVersion`), so a request carrying the envelope and **no** header is served normally: the envelope governs. Only a header that is present but disagrees with the envelope, or is malformed, gets `400` / `-32020`. A server whose spec says the header is required is not enforcing it, and nothing reports that.

The other header rules are enforced (`400` / `-32020`): a missing, mismatched or repeated `Mcp-Method`, and a missing or mismatched `Mcp-Name` on `tools/call`. fetch trims header whitespace, so `"tools/call "` is not malformed.

## WRONG
```ts
// Relies on the SDK to refuse a missing MCP-Protocol-Version header. It does not.
return handler.fetch(request, { authInfo, parsedBody });
```

## RIGHT
```ts
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function missingVersionHeader(body: unknown, headers: Headers): Response | null {
  if (headers.has("MCP-Protocol-Version") || !isRecord(body)) return null;
  const meta = isRecord(body.params) && isRecord(body.params._meta) ? body.params._meta : undefined;
  // No envelope: a 2025-era request, where a missing header means 2025-03-26.
  if (meta === undefined || !("io.modelcontextprotocol/protocolVersion" in meta)) return null;
  const id = typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
  return Response.json(
    { jsonrpc: "2.0", id, error: { code: -32020, message: "Bad Request: the MCP-Protocol-Version header is required" } },
    { status: 400 },
  );
}

const refused = missingVersionHeader(parsedBody, request.headers);
if (refused !== null) return refused;
return handler.fetch(request, { authInfo, parsedBody });
```

## NOTES
- Key the check on the envelope, never on header absence alone: 2025-03-26 clients send neither, and refusing them is the bug in `protocol-version-header-predates-its-rules.md`.
- Test header rules by starting from a fully valid 2026-07-28 request and removing or altering one header at a time.
- Verified 2026-10-12.
