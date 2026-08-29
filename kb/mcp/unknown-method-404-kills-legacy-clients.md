---
tech: mcp
tags: [mcp, streamable-http, json-rpc, error-codes, backwards-compatibility, transport-fallback]
severity: high
---
# A 404 for an unimplemented method kills pre-2026 MCP clients

## PROBLEM

Revision `2026-07-28` says a server that does not implement the requested RPC method MUST answer
`404 Not Found` with JSON-RPC `-32601`. The stated reason is good: the JSON-RPC error body is what
distinguishes a modern server from a legacy HTTP+SSE server that does not host the endpoint at all.

Applying that rule unconditionally breaks every older client.

For revisions `2025-03-26` through `2025-11-25`, a `400`, `404` or `405` on the MCP endpoint is the
documented signal to **abandon Streamable HTTP and fall back to the deprecated HTTP+SSE transport**.
A modern-only server does not serve that transport, so the client then issues `GET`, receives `405`,
and gives up. The connection dies over a method the client was merely *probing* for — clients
routinely try `resources/list` or `prompts/list` even when the capability was never advertised.

The symptom is a connector that fails during or just after handshake with no useful error, and a
server log showing a `404` followed by a `405` on `GET` that looks like correct behaviour in both
cases.

There is a second, separate trap in the same area: an unknown **tool** is not an unknown **method**.
`tools/call` with a bad `params.name` is a bad *parameter* to a method the server implements
perfectly well. Answering that with `404` + `-32601` makes a typo'd tool name look like the endpoint
vanished and sends the client down the same dead fallback path.

## WRONG

```ts
// Unknown METHOD -- 404 unconditionally, so an older client falls back to a
// transport this server does not serve, then gets 405 on GET and gives up.
default:
  return { status: 404, body: rpcError(id, { code: -32601, message: `unknown method ${method}` }) };

// Unknown TOOL -- treated as a missing method, same fatal fallback.
const tool = TOOLS.get(name);
if (!tool) {
  return { status: 404, body: rpcError(id, { code: -32601, message: `unknown tool ${name}` }) };
}
```

## RIGHT

```ts
// Unknown METHOD: 404 only for the era whose clients read it correctly.
default:
  return {
    status: modern ? 404 : 200,
    body: rpcError(id, { code: -32601, message: `unknown method ${method}` }),
  };

// Unknown TOOL: a bad parameter to a method that exists. HTTP 200, -32602.
const tool = TOOLS.get(name);
if (!tool) {
  return {
    status: 200,
    body: rpcError(id, { code: -32602, message: `Unknown tool: ${name}` }),
  };
}
```

## NOTES

- **A refused tool is not an error at all.** A tool that ran and was refused (403, 404, validation
  failure) is a *successful* JSON-RPC result carrying `isError: true`, never a JSON-RPC error.
  Returning it as a protocol error hides the reason from the model, which then retries the identical
  call forever because it never learns what it was told.
- **Hide staff-only tools by answering identically to an unknown name.** If a privileged tool
  returns "forbidden" while a typo returns "unknown", the difference enumerates the privileged tool
  names. Filter them out of `tools/list` *and* answer `tools/call` for them exactly as for a
  nonexistent tool. The real refusal still happens at the route.
- The MCP error codes are `-32020` HeaderMismatch, `-32021` MissingRequiredClientCapability,
  `-32022` UnsupportedProtocolVersion. `-32000`–`-32019` is legacy and must not be used for new
  codes.
- Related: `protocol-version-header-predates-its-rules.md` — the era gate that decides `modern`
  here is itself easy to get wrong.
