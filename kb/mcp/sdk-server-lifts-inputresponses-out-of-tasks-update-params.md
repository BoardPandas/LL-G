---
tech: mcp
tags: [mcp, sdk, tasks, ext-tasks, tasks-update, inputResponses, params-schema, routing]
severity: medium
---
# The SDK server strips `inputResponses` from `tasks/update` params, and routes `tasks/get` and `tasks/cancel` only with an explicit params schema

## PROBLEM
Two behaviours of `@modelcontextprotocol/server` 2.4.0 break a hand-written task handler on the 2026-07-28 era:

1. For `tasks/update`, the SDK moves `inputResponses` out of `params` before any params schema runs. A handler whose schema requires `inputResponses` rejects every valid request. The value is available on the request context instead.
2. `tasks/get` and `tasks/cancel` are routed on the modern era only when they are registered with an explicit params schema. Registered without one, the method answers "method not found".

## WRONG
```ts
server.setRequestHandler("tasks/update", { params: z.object({ taskId: z.string(), inputResponses: z.record(z.unknown()) }) },
  async (params) => {
    // never matches: inputResponses is no longer in params
  });
server.setRequestHandler("tasks/get", handleGet);          // no params schema -> method not found on the modern era
```

## RIGHT
```ts
const taskIdParams = z.object({ taskId: z.string() }).passthrough();   // inputResponses is optional / absent

server.setRequestHandler("tasks/update", { params: taskIdParams }, async (params, ctx) => {
  const inputResponses = ctx.mcpReq.inputResponses ?? params.inputResponses;   // read from the context first
  return answer(params.taskId, inputResponses);
});
server.setRequestHandler("tasks/get", { params: taskIdParams }, handleGet);
server.setRequestHandler("tasks/cancel", { params: taskIdParams }, handleCancel);
```

## NOTES
- Test through the real handler on the modern era. A unit test that calls your function with hand-built params passes in both broken states.
- A flat task result from a low-level `tools/call` handler passes through the SDK unchanged (it adds `content: []`), so no fallback handler is needed.
