---
tech: llm-integration
tags: [prompt-context, scoped-edits, tool-calls, regression-testing, image-generation]
severity: high
---
# Recipe context does not preserve unrequested traits during an LLM edit

## PROBLEM

Giving an LLM the current recipe and an instruction to preserve it does not make a constrained edit safe. A palette-only request can still rewrite unrelated genre, mood, medium, anatomy, or negative constraints, even after the model has explicitly read the current recipe. The model can then describe invented additions as retained traits, producing a plausible but silently wrong derivative.

## WRONG

```ts
const system = `${BASE_PROMPT}\nParent recipe:\n${currentRecipe}\nPreserve the parent unless asked otherwise.`;
await runAgentLoop({ system, history, tools });
// Accept a broad set_prompt_fragment tool call because the prompt contains the parent.
```

## RIGHT

```ts
const system = `${BASE_PROMPT}

This is a scoped remix. The current recipe is authoritative.
For a palette-only request, keep every non-color phrase verbatim, replace only
the existing color phrase, and preserve all negative constraints. Do not add
new motifs, anatomy, medium, mood, genre, or exclusions.`;

const proposal = await runAgentLoop({ system, history, tools: inMemoryTools });
assertOnlyAllowedFieldMutation(proposal, currentRecipe, { changedField: "palette" });
```

## NOTES

Keep current and parent recipes distinct: current state is authoritative after prior turns, while the parent establishes lineage. Test actual proposed tool calls and full-field mutations for both additions/removals and retained negative exclusions, with rendering disabled for cheap text-only acceptance. Prompt context is necessary but does not prove visual adherence by an image generator; visual comparison requires a separate real-render acceptance check.
