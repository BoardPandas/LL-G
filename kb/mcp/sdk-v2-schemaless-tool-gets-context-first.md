---
tech: mcp
tags: [mcp, sdk, mcpserver, registerTool, error-handling, information-disclosure, wrapper]
severity: high
---
# SDK v2 calls a tool without `inputSchema` as `cb(ctx)`, and shows thrown messages to the client

## PROBLEM
Two behaviours of `McpServer.registerTool` in `@modelcontextprotocol/server` 2.0.0 break the usual `wrap = (fn) => async (args) => ...` error wrapper:

1. A tool registered **without** `inputSchema` is called as `cb(ctx)`, not `cb(args, ctx)`. A wrapper that treats its first parameter as `args` passes the request context (auth info, HTTP request, ...) into the tool as its arguments.
2. Anything a callback throws becomes an `isError` result whose text is the raw `error.message`. A D1 or driver message (`UNIQUE constraint failed: ...`, or one embedding a stored value) goes straight to the client.

## WRONG
```ts
const wrap = (fn: (args: any) => Promise<unknown>) => async (args: any) => toolResult(await fn(args));

server.registerTool("session_info", { description }, wrap(async (args) => lookup(args.session)));
// args is the context object, and a throw inside lookup() is returned to the client verbatim
```

## RIGHT
```ts
export async function wrap(run: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return toolResult(await run());
  } catch (error) {
    if (error instanceof ToolError) return refusal(error.code, error.message, error.hint);
    logError("tool_unexpected_error", { name: error instanceof Error ? error.name : typeof error });
    return refusal("internal", "Could not complete this tool call.", "Retry once, then tell your person.");
  }
}

server.registerTool("session_info", { description }, (ctx) => wrap(() => sessionInfo(ctx)));
server.registerTool("send", { inputSchema }, (args, ctx) => wrap(() => send(args, ctx)));
```

## NOTES
- Log only `error.name`; the message can carry stored data or request content.
- Exercise a schema-less tool through a real `tools/call`, not by invoking the callback with `{}` in a unit test, which hides the shifted argument.
- Verified 2026-10-12.
