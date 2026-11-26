---
tech: mcp
tags: [mcp, ext-tasks, tasks, createTaskSessionFromClient, pooled-client, gateway]
severity: medium
---
# `createTaskSessionFromClient` does not fit an MCP client that serves concurrent requests

## PROBLEM
`@modelcontextprotocol/ext-tasks` offers `createTaskSessionFromClient(client, options)` to give an SDK `Client` task support. It is built for a client that one caller owns:

- For a 2026-07-28 server it requires `rawDispatch` and `v2RequestFraming` options, because the SDK client has no public raw-request hook. Without them it throws.
- It allows one adapter per client (a second call throws "an ext-tasks adapter is already active for this Client").
- It installs its own fallback request and notification handlers on the client, replacing whatever the client had.

A gateway or pool that shares one upstream client between many users' requests cannot use it: the handlers it replaces belong to every request, and the single-session limit means one caller's task session blocks the next.

## WRONG
```ts
// One pooled client, many concurrent callers
const session = createTaskSessionFromClient(pooledClient, { endpointId: toolkit });
// throws on the second request, or replaces handlers other requests depend on
```

## RIGHT
```ts
// Use only the wire schemas from ext-tasks core/v2 and drive tasks/get, tasks/update and
// tasks/cancel as ordinary requests on the pooled client, scoping state per task id and user.
import { DetailedTaskV2Schema } from "@modelcontextprotocol/ext-tasks/core/v2";

const result = await pooledClient.request({ method: "tasks/get", params: { taskId } }, DetailedTaskV2Schema);
```

## NOTES
- The adapter is a good fit when one caller owns the client for the whole conversation (a desktop host, a CLI).
- `client.request` deletes `resultType` before validating, so a schema that requires `resultType` cannot be used with it; use the detailed-task schema.
- The call that creates the task is a separate problem on the 2026-07-28 era; see the entry on the SDK client rejecting task results.
