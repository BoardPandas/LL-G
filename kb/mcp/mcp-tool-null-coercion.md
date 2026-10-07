---
tech: mcp
tags: [tool-call-encoding, null-coercion, schema-mismatch, silent-wrong-output]
severity: high
---
# MCP tool-call encoding coerces null to the string "null"

## PROBLEM
Schema accepts `resourceId: null` as the way to clear, but MCP encoding sends the string "null". Handler branches on `args.resourceId === null`, which is false, so it assigns the string "null" verbatim. The one documented clear path is unreachable from MCP.

## WRONG
```typescript
if (args.resourceId === null) {
  await db.update(card).set({ resourceId: null });  // Never fires
} else {
  await db.update(card).set({ resourceId: args.resourceId });  // Stores "null"
}
```

## RIGHT
```typescript
const resourceId = args.resourceId === "null" || args.resourceId === "" ? null : args.resourceId;
if (!resourceId) {
  await db.update(card).set({ resourceId: null });
} else {
  await db.update(card).set({ resourceId });
}
```

## NOTES
A dangling id degrades quietly. Clear via REST API with JSON null, or document the workaround in the tool description.
