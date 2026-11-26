---
tech: typescript
tags: [typescript, json, json-stringify, size-limit, escaping, serialization, bytes, bounds]
severity: medium
---
# A size bound on serialised JSON does not match a cap on the raw text inside it

## PROBLEM
Each item is capped on its raw text size (say 100 KB per result), and the stored or sent payload is bounded on its JSON text (say 2 MB for 20 results, the sum of the caps). JSON escaping makes text larger: quotes, backslashes, newlines and non-ASCII characters grow, and pretty-printed JSON that is itself embedded as a string grows again. In one measurement, 20 results capped on raw bytes, each holding pretty-printed JSON, serialised to about 2.4 MB against a 2 MB bound. An operation that succeeded when answered directly then fails when its result is stored, because the two limits measured different things.

## WRONG
```ts
const MAX_ITEM_BYTES = 100_000;
const MAX_STORED_BYTES = 20 * MAX_ITEM_BYTES;          // "sum of the caps"

const item = capText(result, MAX_ITEM_BYTES);           // measured on raw text
if (Buffer.byteLength(JSON.stringify(payload)) > MAX_STORED_BYTES) fail();   // measured on escaped JSON
```

## RIGHT
```ts
// Measure both the same way, or leave headroom and write down why.
const MAX_STORED_MULTIPLE = 60;                         // 3x the unescaped worst case of 20 items
const MAX_STORED_BYTES = MAX_STORED_MULTIPLE * MAX_ITEM_BYTES;

// A test that builds the worst case and stores it:
const worst = Array.from({ length: 20 }, () => capText(JSON.stringify(bigObject, null, 2), MAX_ITEM_BYTES));
expect(fitsStorage({ items: worst })).toBe(true);
```

## NOTES
- Test with escape-heavy input (quotes, newlines, multi-byte text, JSON inside a string), not with plain ASCII.
- Use `Buffer.byteLength` for bytes; `string.length` counts UTF-16 units.
- The same mismatch appears between a database column limit and the text it stores, or between a request-size limit and the body it caps.
