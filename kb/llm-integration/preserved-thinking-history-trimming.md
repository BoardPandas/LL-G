---
tech: llm-integration
tags: [anthropic, claude, thinking, preserved-thinking, history-trimming, context-window, opus-5-5, sonnet-5-5, 400]
severity: high
---
# Trimming chat history while replaying thinking blocks 400s on newer Claude models

## PROBLEM
Claude Opus 5.5, Sonnet 5.5 and Fable 5.1 ("preserved thinking") bind each
thinking block to the exact `system`, `tools` and earlier messages that preceded
it. If a harness edits history -- truncates an old `tool_result`, or drops old
turns with a sliding window -- and then replays assistant turns that still carry
their `thinking` / `redacted_thinking` blocks, the request is a 400. Enforced by
default for accounts created on or after 2026-08-31 on the Claude API and Amazon
Bedrock.

It hides well: the trim only fires on long sessions (SupportForge's Technician
Console trimmed at 500KB), so unit tests and short sessions stay green; and only
newer accounts are enforced, so with BYOK keys it looks like one customer's
account is broken. Swapping in a newer model (e.g. Sonnet 5 -> Sonnet 5.5) turns
a previously safe trim into a failure with no code change.

## WRONG
```typescript
// Truncate old tool output, then replay assistant turns verbatim
for (const msg of messages) {
  for (const block of msg.content ?? []) {
    if (block.type === 'tool_result' && block.content.length > 2000) {
      block.content = block.content.slice(0, 2000) + '[truncated]';
    }
  }
}
if (tooBig(messages)) messages = messages.slice(-7);
// assistant turns still contain { type: 'thinking', signature } -> 400
```

## RIGHT
```typescript
let edited = false;
// ...truncate / window as before, setting edited = true when anything changes...
if (edited) {
  // Thinking from completed turns is safe to drop; never replay it after an edit.
  messages = messages.flatMap(msg => {
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) return [msg];
    const content = msg.content.filter(
      (b: any) => b?.type !== 'thinking' && b?.type !== 'redacted_thinking');
    return content.length > 0 ? [{ ...msg, content }] : []; // API merges adjacent user turns
  });
}
```

## NOTES
- Only trim at the start of a new user turn, never mid tool loop: the in-flight
  assistant turn's thinking must still be passed back unchanged.
- Alternatives: with adaptive thinking, send beta header
  `thinking-binding-controls-2026-08-01` and
  `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` (not allowed
  with Sonnet 5.5's `between_tools`); or keep history append-only and use
  server-side compaction / context editing instead of client-side trimming.
- Test both directions: trimmed history carries no thinking blocks, AND
  untrimmed history still replays them (an always-strip fix also passes the
  first test).
- Source: SupportForge `src/services/technician-ai.ts` `boundHistory()`, fixed in
  v3.275.0.0.
