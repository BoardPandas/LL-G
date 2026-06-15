---
tech: llm-integration
tags: [openrouter, reasoning-models, streaming, sse, chain-of-thought, silent-hang, observability, agent-loop]
severity: high
---
# Reasoning models spiral silently in delta.reasoning, looking like an empty hang

## PROBLEM

Reasoning models (Qwen "thinking", OpenAI o-series, DeepSeek-R1, etc.) stream their
chain-of-thought in a SEPARATE delta field from the answer. On OpenRouter's normalized
OpenAI-compatible SSE that field is `delta.reasoning` (some providers send
`delta.reasoning_content` instead), distinct from `delta.content` (the answer text) and
`delta.tool_calls` (the actions you must fulfill).

A model that "spirals" floods the reasoning channel while emitting ZERO `delta.content`
and ZERO `delta.tool_calls`. To a consumer that only watches content + tool_calls, the
turn looks completely silent: no text, no action, and no error. It appears to hang until
`max_tokens` is reached (turn ends with `finish_reason: "length"`) or your own timeout
fires.

The failure is OPAQUE. Logs show "0 tool calls, empty output, then timeout" with no hint
that the model was actually burning its entire budget reasoning before its first action.
A genuinely-empty turn (model had nothing to say) and a spiral (model said a LOT, just all
in the channel you weren't reading) are INDISTINGUISHABLE if you only track content length
and tool-call count. You cannot tell "stuck" from "done" without accounting for the
reasoning channel.

This bit the tcg eval combo-check regression (2026-06-14): a Phase-1 `loop_check` pass
looked like it silently did nothing, when the backing reasoning model was spiraling before
ever calling a tool.

## WRONG

```typescript
// Only watches content + tool_calls. A spiraling reasoning model produces neither,
// so the turn looks identical to a healthy empty turn -- silent hang until timeout.
for await (const chunk of streamSse(res)) {
  const delta = chunk?.choices?.[0]?.delta;
  if (delta?.content) {
    text += delta.content;
    yield { type: "text-delta", delta: delta.content };
  }
  if (Array.isArray(delta?.tool_calls)) {
    accumulateToolCalls(delta.tool_calls);
  }
  // delta.reasoning is never read -> the spiral is invisible.
}
```

## RIGHT

```typescript
let reasoningChars = 0;
let reasoningChunks = 0;
let contentChars = 0;

for await (const chunk of streamSse(res)) {
  const delta = chunk?.choices?.[0]?.delta;
  if (delta?.content) {
    text += delta.content;
    contentChars += delta.content.length;
    yield { type: "text-delta", delta: delta.content };
  }
  // Providers differ on which field they use; OpenRouter passes the provider's
  // field through under its normalization, so read BOTH.
  const reasoningDelta =
    typeof delta?.reasoning === "string" ? delta.reasoning
    : typeof delta?.reasoning_content === "string" ? delta.reasoning_content
    : "";
  if (reasoningDelta) {
    reasoningChars += reasoningDelta.length;
    reasoningChunks += 1;
  }
  if (Array.isArray(delta?.tool_calls)) {
    accumulateToolCalls(delta.tool_calls);
  }
}

// Spiral signature: budget spent entirely on reasoning, nothing actionable emitted.
// The three-way conjunction almost never fires on a healthy turn, so this is low-noise
// and diagnostic-only -- it turns an opaque "silent hang then timeout" into a log line.
if (reasoningChars > 0 && contentChars === 0 && toolCalls.length === 0) {
  console.warn(
    `[llm] turn emitted ONLY reasoning (${reasoningChars} chars over ${reasoningChunks} ` +
    `delta(s)), no content and no tool calls -- finish_reason=${finishReason}, ` +
    `max_tokens=${maxTokens}, model=${model}. A reasoning model may be spiraling.`,
  );
}
```

## NOTES

- Read BOTH `delta.reasoning` and `delta.reasoning_content`. Providers differ on which
  they send; OpenRouter normalizes but passes the provider's field through.
- Detection is diagnostic-only and deliberately low-noise: the
  `reasoning > 0 && content == 0 && calls == 0` conjunction is the spiral, and it
  essentially never matches a healthy turn. Include `finish_reason`, `max_tokens`, and
  `model` in the warning so the run is diagnosable from logs alone.
- This does not fix the spiral (that is a prompt/model/effort-budget problem); it makes
  the failure observable instead of an opaque hang. Once visible, the levers are reasoning
  `effort`, `max_tokens`, prompt clarity, or swapping the model.
- Reference implementation: tcg `dashboard/src/lib/agent-loop/openrouter-backend.ts`
  (the `runTurn` reasoningChars/reasoningChunks counters + the post-turn `console.warn`),
  shipped v3.4.1.1.
- Sibling design lessons from the same eval-reliability work live in BP (a presence-only
  validator is a floor, not a ceiling; reconcile LLM self-assessments against deterministic
  checks directionally).
