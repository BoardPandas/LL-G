---
tech: llm-integration
tags: [tool-calling, workflow-state, provider-apis, fail-closed]
severity: high
---
# Prompt instructions cannot require a tool call

## PROBLEM

A system prompt can say that an active workflow MUST call a checkpoint tool first, yet the model can skip the tool and return a convincing acknowledgement. If the application then presents and persists that prose, the user sees success while the server-owned workflow state never changed. The next turn can silently reopen a rejected direction even though prompt tests and the visible reply both looked correct.

## WRONG

```typescript
const result = await runAgentLoop({
  system: "Call record_workflow_checkpoint before every workflow reply.",
  tools,
  dispatch,
});

await persistAssistantReply(result.text);
```

## RIGHT

```typescript
const requiredTool = "record_workflow_checkpoint";
let pendingRequiredTool: string | null = requiredTool;

while (pendingRequiredTool) {
  const response = await providerCall({
    tools,
    toolChoice: forceNamedTool(provider, pendingRequiredTool),
    parallelToolCalls: false,
  });

  assertExactlyOneToolCall(response, pendingRequiredTool);
  const outcome = await dispatch(pendingRequiredTool, response.arguments);
  if (outcome.isError) continue;

  pendingRequiredTool = null;
}

if (!workflowStateWasStaged()) {
  throw new Error("Required workflow checkpoint was not staged.");
}
```

## NOTES

Use each provider's native named-tool selection and pin its exact wire shape in adapter tests. Keep the gate armed after validation or dispatch errors, and buffer user-visible prose until the server confirms that valid state was staged. A model-emitted tool call is not success by itself; the trusted dispatcher outcome and final state are the authority. This adds no extra call on the normal path when the existing tool loop already requires the checkpoint.
