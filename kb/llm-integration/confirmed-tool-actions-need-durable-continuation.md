---
tech: llm-integration
tags: [tool-calling, agent-loop, confirmation, idempotency, sse]
severity: high
---
# Confirmed tool actions need a durable continuation turn

## PROBLEM
An agent that pauses for human confirmation may execute and persist the confirmed tool result successfully, yet never ask the model to continue from that result. The UI shows "action completed" forever, with no exception and no final assistant response. This is not a rendering problem: the agent loop ended at the confirmation boundary and no durable work item exists to resume it.

## WRONG
```typescript
await saveToolResult(actionId, result);
emitActionCompleted(actionId);
// The original model stream already ended, so nothing consumes this result.
```

## RIGHT
```typescript
await db.transaction(async (tx) => {
  await saveToolResult(tx, actionId, result);
  await enqueueContinuationTurn(tx, {
    idempotencyKey: `action-continuation:${actionId}`,
    conversationId,
    actionId,
  });
});

emitActionCompleted({ actionId, continuationTurnId });
// The client follows the continuation turn's stream until the model finishes.
```

## NOTES
The continuation must reauthorize under the original tenant and user, preserve the tool result, and carry a server-trusted marker so the model continues rather than repeats the confirmed action. Use a unique idempotency key per action because polling, reconnects, and retries can all observe the same terminal state.
