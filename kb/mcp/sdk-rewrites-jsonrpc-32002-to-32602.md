---
tech: mcp
tags: [mcp, sdk, json-rpc, error-codes, resources-read, not-found, spec]
severity: medium
---
# The SDK sends "resource not found" as `-32602`, not `-32002`

## PROBLEM
Older MCP revisions and many examples use JSON-RPC error `-32002` for an unknown resource. In `@modelcontextprotocol/server` 2.x a thrown `-32002` is rewritten to `-32602` (invalid params) on the wire, and the SDK's own `ResourceNotFoundError` is `-32602` with `data: { uri }`. The SDK still accepts `-32002` when it receives one from an older peer, but it never emits it. A spec, an acceptance criterion or a test that promises `-32002` describes something the server cannot send, and the test fails or, worse, is written to match a mock rather than the wire.

## WRONG
```ts
// spec: "an unknown resource returns -32002"
throw new ProtocolError(-32002, "Resource not found", { uri });

// test
expect(response.error.code).toBe(-32002);     // the wire says -32602
```

## RIGHT
```ts
// Use the SDK's error and assert what a real client sees
throw new ResourceNotFoundError(uri);          // -32602, data: { uri }

const response = await callThroughRealHandler("resources/read", { uri: "ui://missing" });
expect(response.error.code).toBe(-32602);
expect(response.error.data).toEqual({ uri: "ui://missing" });
```

## NOTES
- Write the spec and the test for `-32602`; a client that must also recognise `-32002` from peers on older SDKs should accept both.
- Test through the real handler (not by calling your function), because the rewrite happens in the SDK's encoding layer.
- Related: for an unimplemented method, the 2026-07-28 revision answers HTTP 404 with `-32601`, while a 2025-era client reads the same code from an HTTP 200 body.
