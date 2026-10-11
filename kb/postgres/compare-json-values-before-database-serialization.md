---
tech: postgres
tags: [node-postgres, jsonb, serialization, inventory, audit]
severity: high
---
# Compare JSON values before database serialization

## PROBLEM

A JSONB column is read back by node-postgres as a JavaScript object. If incoming attributes are stringified before a change detector compares them with that object, equal data appears different on every ingestion. A canonical JSON comparison does not help: an object and a string containing JSON are different values. Audit display values can also become double encoded. The database still accepts writes, so normal success-path checks miss the false history.

## WRONG

```typescript
const next = JSON.stringify(report.attributes ?? {});
// previous.attributes is an object decoded from JSONB.
if (stableJson(previous.attributes) !== stableJson(next)) {
  await recordChange(stableJson(previous.attributes), stableJson(next));
}
await client.query('UPDATE inventory SET attributes = $1 WHERE id = $2', [next, id]);
```

## RIGHT

```typescript
// Validate the report at ingress, then retain the domain representation.
const next = report.attributes ?? {};
if (stableJson(previous.attributes) !== stableJson(next)) {
  await recordChange(stableJson(previous.attributes), stableJson(next));
}
// node-postgres serializes ordinary object parameters at the write boundary.
await client.query('UPDATE inventory SET attributes = $1 WHERE id = $2', [next, id]);
```

## NOTES

- Preserve the existing canonical object-key ordering so reordered keys do not create changes. Arrays and scalar values still need their intended domain semantics.
- Verify the specific driver's conversion rules. The example applies to ordinary node-postgres object parameters without custom conversion methods.
- Exercise the actual ingestion path with object-shaped database readback. Cover reordered string properties, booleans and numbers, empty attributes, omitted attributes, and one genuine change.
- Assert that unchanged reports add no history, the write receives the native object, and real before/after values are readable JSON without an extra string-encoding layer.
- Fixing future comparisons does not repair historical events. Assess any cleanup separately; do not silently delete audit history as part of a UI or serialization fix.
