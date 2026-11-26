---
tech: mcp
tags: [mcp, tasks, ext-tasks, tools-call, resultType, schema, sep-2663]
severity: medium
---
# A task-creating `tools/call` result is flat: task fields sit beside `resultType`, not under a `task` key

## PROBLEM
Under the 2026-07-28 tasks extension a `tools/call` that starts a task answers with `Result & Task`: `resultType: "task"`, `taskId`, `status`, `createdAt`, `lastUpdatedAt`, `ttlMs` (and optionally `statusMessage`, `pollIntervalMs`) all at the top level. Earlier drafts and many sketches nest the fields under a `task` key. A nested answer fails the SDK's validation on the client, so the client either errors or never learns the task id, and a hand-written test that checks only its own expectation passes.

## WRONG
```ts
return { resultType: "task", task: { taskId, status: "working", ttlMs } };   // nested: rejected by the SDK
```

## RIGHT
```ts
return {
  resultType: "task",
  taskId,
  status: "working",
  createdAt: now.toISOString(),
  lastUpdatedAt: now.toISOString(),
  ttlMs,
  pollIntervalMs: 2000,
};

// Test the shape with the SDK's own schema, not with your own expectations
import { CreateTaskResultV2Schema } from "@modelcontextprotocol/ext-tasks/core/v2";
expect(CreateTaskResultV2Schema.safeParse(await callTool()).success).toBe(true);
```

## NOTES
- A `tasks/get` result carries the same fields plus `result`, `error` or `inputRequests` depending on state, with `resultType: "complete"`; parse it with the detailed-task schema in a test.
- A low-level `tools/call` handler may return the flat object directly; the SDK passes it through and adds `content: []`.
