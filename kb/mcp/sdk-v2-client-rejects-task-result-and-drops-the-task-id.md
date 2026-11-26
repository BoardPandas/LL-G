---
tech: mcp
tags: [mcp, sdk, tasks, ext-tasks, client, tools-call, resultType, proxy]
severity: high
---
# The MCP SDK v2 client rejects a `resultType: "task"` answer before any schema runs, and the error drops the task id

## PROBLEM
On a 2026-07-28 connection, a server that supports the tasks extension may answer `tools/call` with a task (`resultType: "task"`, a `taskId`) instead of a result. In `@modelcontextprotocol/client` 2.4.0 the result decoder rejects every `resultType` other than `"complete"` and throws `SdkError` with code `UnsupportedResultType`. The error keeps only `{ resultType, method }`, so the task id is lost, and no result schema or hook runs first. A relay or gateway that forwards `callTool` can therefore never learn the id of a task the upstream created, although the upstream has started the work.

## WRONG
```ts
try {
  return await pooledClient.callTool({ name, arguments: args });
} catch (err) {
  // UnsupportedResultType: the task exists upstream, but its id is not in the error
  throw err;
}
```

## RIGHT
Make the task-capable call on a short-lived second client built from the pooled client's own settings, and tap that private transport for the one response the decoder would reject. Everything else stays on the pooled client.
```ts
const transport = new StreamableHTTPClientTransport(pooled.url, pooled.transportOptions);
const callClient = new Client(pooled.clientInfo, {
  capabilities: pooled.capabilities,
  supportedProtocolVersions: [negotiatedVersion],
});
// Adopt the pooled client's server/discover result: no extra round trip.
await callClient.connect(transport, { prior: { kind: "modern", discover: pooled.getDiscoverResult() } });

let taskResult: Record<string, unknown> | undefined;
const deliver = transport.onmessage;
transport.onmessage = (message) => {
  if (isJSONRPCResultResponse(message) && ourToolCallIds.has(message.id) && message.result.resultType === "task") {
    taskResult = structuredClone(message.result); // copy before the decoder sees it
  }
  deliver?.(message);
};

try {
  return { kind: "result", result: await callClient.callTool(params, { ...options }) };
} catch (err) {
  if (taskResult && isUnsupportedResultType(err)) return { kind: "task", task: taskResult };
  throw err;
} finally {
  await callClient.close();
}
```

## NOTES
- Use only public SDK API, and the SDK's own `callTool`, so envelope, headers, auth and error mapping stay the SDK's.
- Only record a result whose id belongs to a `tools/call` this client sent (wrap `transport.send` to collect ids).
- This is sound for the modern era because it is sessionless: a sibling transport needs no session id or resumption state. It is not valid for a legacy (session-based) connection.
- Pass the tool definition to `callTool` when you have it. Without it the SDK skips output validation and header mirroring, and on a header-mismatch error it retries the `tools/call`, which can run a non-idempotent write twice.
- Do this only for calls that can return a task (feature-flag it); ordinary traffic should not pay for a second client.
