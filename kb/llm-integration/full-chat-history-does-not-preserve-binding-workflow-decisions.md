---
tech: llm-integration
tags: [llm, chat, workflow-state, tool-loop, persistence, idempotency]
severity: high
---
# Full chat history does not preserve binding workflow decisions

## PROBLEM

Replaying every stored chat message preserves chronology, but it does not tell the model which choices are now binding. In a guided workflow, an explicitly rejected path can remain prominent in the transcript and be offered again after a topic shift or a long tool loop. The failure looks like forgetfulness even though no messages are missing: the response is fluent and grounded in real history, but it treats a superseded option as current.

A presentation-only fix can create a second silent failure. Tool-capable providers may emit provisional prose before calling a tool. If the application hides that prose and interprets "no visible final text" as permission to invoke a fallback model, the fallback can run after the first loop already performed a write. The user sees one polished answer while the system performs the mutation twice.

## WRONG

```ts
const messages = await loadAllMessages(conversationId);
const turn = await runToolLoop({ messages });

let visibleText = "";
for await (const event of turn.events) {
  if (event.type === "text-delta") {
    visibleText += event.text; // mixes provisional and terminal prose
  }
}

if (!visibleText) {
  visibleText = await fallbackChat(messages); // may run after a tool wrote
}

await saveAssistantMessage(conversationId, visibleText);
```

## RIGHT

```ts
const snapshot = await loadConversation(conversationId);
const turn = await runToolLoop({
  providerMessages: snapshot.messages,
  workflowCheckpoint: snapshot.workflowCheckpoint,
});

let finalText = turn.finalText; // terminal presentation only
if (!finalText && !turn.hadToolActivity) {
  finalText = await fallbackChat(snapshot.messages);
}
if (!finalText) {
  throw new IncompleteToolTurnError(); // never rerun after tool activity
}

await db.transaction(async (tx) => {
  await persistTurnMessages(tx, conversationId, turn.messages, finalText);
  await persistWorkflowCheckpointCas(tx, {
    conversationId,
    expectedRevision: snapshot.workflowRevision,
    checkpoint: turn.checkpoint, // bounded, explicit current-user evidence only
  });
});
```

## NOTES

- The checkpoint supplements the full transcript; it does not replace or summarize it.
- Record only explicit user decisions, rejections, the active phase, and at most the current open question. Do not infer durable preferences from assistant prose.
- Keep raw provider continuation state separate from user-visible presentation so tool protocols retain every required message while provisional narration stays hidden.
- Once any tool activity occurs, recover from the durable tool result with idempotency or return a controlled incomplete-turn error. Do not start a fresh fallback generation that could repeat the side effect.
- Persist the terminal messages and checkpoint in one transaction with a revision check so a concurrent turn cannot attach decisions to the wrong history.

