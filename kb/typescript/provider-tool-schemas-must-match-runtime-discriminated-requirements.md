---
tech: typescript
tags: [tool-calling, json-schema, zod, llm, discriminated-union, silent-failure]
severity: high
---
# Provider tool schemas must match runtime discriminated requirements

## PROBLEM
A model-facing JSON Schema can accept an operation that the runtime Zod schema rejects when the provider schema requires only common fields while the reducer requires additional fields for each discriminated variant. The tool call looks valid to the provider, but the runtime refuses it. In a chat workflow the assistant can still acknowledge the user's decision in prose while the durable checkpoint remains empty, so the failure is silent until a later turn forgets the decision.

Requiring two independently model-authored fields to contain exact source evidence creates a second version of the same trap. Models naturally paraphrase a summary field even when they quote the evidence field correctly, causing valid intent to be discarded.

## WRONG
```typescript
const providerSchema = {
  type: "object",
  properties: {
    kind: { enum: ["record", "supersede", "reset"] },
    axis: { type: "string" },
    value: { type: "string" },
    disposition: { enum: ["confirmed", "rejected"] },
    id: { type: "string" },
    userSaid: { type: "string" },
  },
  required: ["kind", "userSaid"],
};

const RuntimeRecord = z.object({
  kind: z.literal("record"),
  axis: z.string(),
  value: z.string(),
  disposition: z.enum(["confirmed", "rejected"]),
  userSaid: z.string(),
});

if (!isExactExcerpt(operation.value, currentUserMessage)) reject();
if (!isExactExcerpt(operation.userSaid, currentUserMessage)) reject();
```

## RIGHT
```typescript
const providerOperationSchema = {
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { const: "record" },
        axis: { type: "string" },
        disposition: { enum: ["confirmed", "rejected"] },
        userSaid: { type: "string" },
      },
      required: ["kind", "axis", "disposition", "userSaid"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "supersede" },
        id: { type: "string" },
        userSaid: { type: "string" },
      },
      required: ["kind", "id", "userSaid"],
      additionalProperties: false,
    },
  ],
};

const RuntimeRecord = z.object({
  kind: z.literal("record"),
  axis: z.string(),
  disposition: z.enum(["confirmed", "rejected"]),
  userSaid: z.string(),
  value: z.string().optional(), // compatibility only
});

assertExactExcerpt(operation.userSaid, currentUserMessage);
const storedValue = operation.value && isExactExcerpt(operation.value, currentUserMessage)
  ? operation.value
  : operation.userSaid;
```

## NOTES
Make required bookkeeping a first-class step in the workflow, not an optional suggestion. Test the model-facing schema against every runtime variant, then run an end-to-end evaluation that inspects the durable state after the turn; a fluent assistant response is not evidence that the write happened.
