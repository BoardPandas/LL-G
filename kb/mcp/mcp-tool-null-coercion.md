---
tech: mcp
tags: [tool-call-encoding, null-coercion, schema-mismatch, silent-wrong-output]
severity: high
---
# MCP tool-call encoding coerces null to the string "null"

## PROBLEM
A tool documents `resourceId: null` as the way to clear a link, and the schema is `z.string().nullable()`, so null is valid JSON. When the tool call comes through MCP encoding, the null is coerced to the **string** `"null"`. The handler branches on `args.resourceId === null`, which is then false, so it takes the *assign* path and stores the string `"null"` verbatim. The result header even reads "Assign resource null", not "Clear". The one documented clear path is unreachable from MCP.

## WRONG
```typescript
// Schema says it's nullable
const schema = z.object({
  resourceId: z.string().nullable()
});

// Handler logic
if (args.resourceId === null) {
  // Clear the link
  await db.update(card).set({ resourceId: null });
} else {
  // Assign the link
  await db.update(card).set({ resourceId: args.resourceId });
}
```

MCP tool call with `resourceId: null` arrives as string `"null"`, and the null-check never fires.

## RIGHT
```typescript
// Normalize MCP string "null" to actual null before branching
const normalizeResourceId = (input: string | null): string | null => {
  if (input === null || input === "null") return null;
  if (input === "") return null; // also falsy in downstream consumers
  return input;
};

const resourceId = normalizeResourceId(args.resourceId);

if (!resourceId) {
  // Clear the link
  await db.update(card).set({ resourceId: null });
} else {
  // Assign the link
  await db.update(card).set({ resourceId });
}
```

Alternatively, clear via the direct REST API (`PATCH /api/resource/:id` with JSON null) rather than the MCP tool, or document the workaround explicitly in the tool description.

## NOTES
A dangling id degrades quietly—the downstream JSON-RPC consumer guards on `existsSync(.resource/:id/approved.png)` and falls through to the default art when the id does not resolve. This quiet degradation makes the bug invisible: the workaround appears to work while leaving junk in the manifest. If a real id lands instead, shared art outranks generated art at render time, so perfect prompts still print generic catalog art.

MCP tool encoding always coerces falsy values. The trailing transport layer normalizes them again BEFORE the handler receives them, so the coercion is a surprise only to logic that branches inside the handler. Check the boundaries: what does the MCP encoding layer actually send, and where does normalization happen?
