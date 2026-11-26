---
tech: mcp
tags: [mcp, tasks, gateway, authorization, read-only, audit-log, tasks-update, tasks-cancel]
severity: high
---
# A long-running task is a tool call that outlives its checks: every later step needs the policy check and its own audit entry

## PROBLEM
With MCP tasks, one `tools/call` becomes a task that is advanced later by `tasks/update` (answering a question it asked) and ended by `tasks/cancel`. A gateway that applies its policy (read-only mode, per-tool allow rules) and writes its audit entry only in the `tools/call` handler leaves the later steps unchecked and unrecorded. Two failures follow, both silent: a write is allowed through on a connection that was switched to read-only after the task started, and the answers a user gave and the cancellations never appear in the audit log.

## WRONG
```ts
server.setRequestHandler("tools/call", async (req, ctx) => {
  assertAllowed(ctx.user, toolkit, tool);        // policy checked once
  audit(ctx.user, tool, "started");
  return startTask(req);
});

server.setRequestHandler("tasks/update", { params }, async (p, ctx) =>
  forwardAnswer(p.taskId, ctx.mcpReq.inputResponses));      // no policy re-check, no audit row
```

## RIGHT
```ts
server.setRequestHandler("tasks/update", { params }, async (p, ctx) => {
  const row = await loadTask(p.taskId, ctx.user);
  if (!stillAllowed(ctx.user, row.toolkit, row.tool)) {       // read-only may have changed since the call started
    await cancelUpstream(row);
    await audit(ctx.user, row.tool, "denied", { keys: Object.keys(responses) });
    throw refusal();
  }
  await audit(ctx.user, row.tool, "answered", { keys: Object.keys(responses) });   // key names only, never values
  return forwardAnswer(row, responses);
});
// tasks/cancel writes its own audit row as well.
```

## NOTES
- Audit the names of the answered keys, never the values: the values are the user's input and may be secrets.
- Make the denied path cancel the task upstream, not only refuse the update, so it does not sit waiting.
- Polling (`tasks/get`) does not need an audit row if the start was audited; state that decision in the design.
- Write the test as "start a task while writable, switch the connection to read-only, answer it": the answer must be refused.
