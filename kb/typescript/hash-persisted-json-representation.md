---
tech: typescript
tags: [json, jsonb, audit, hashing, canonicalization, undefined]
severity: high
---
# Hash the persisted JSON representation, not the original JS object

## PROBLEM
A deterministic audit encoder can hash a different value from what JSON storage retains. A present undefined property may be included by the hash encoder as null, while JSON.stringify omits it. Dates, custom toJSON methods, sparse arrays, and non-finite numbers also change during serialization. Verification after a database read then reports apparent tampering even though the stored row was never edited.

## WRONG
```typescript
const digest = hashRecord(detail);
await insert({ detail: JSON.stringify(detail), digest });
```

## RIGHT
```typescript
const detailJson = JSON.stringify(detail);
if (detailJson === undefined) throw new TypeError('Not JSON serializable');
const persistedDetail = JSON.parse(detailJson);
const digest = hashRecord(persistedDetail);
await insert({ detail: detailJson, digest });
```

## NOTES
Serialize once and reuse the exact string for persistence so a stateful toJSON cannot produce different values for hashing and storage. Fail closed if serialization fails. Test the complete write/read/verify round trip, including nested undefined, Date, sparse arrays, custom toJSON, non-finite numbers, and unsupported values such as BigInt.

Never change a historical hash encoder or rewrite retained rows merely to clear verification errors. Preserve the original export and checksum, reconstruct the demonstrated legacy input, and require an exact match to the original stored hash before classifying an encoding defect. Keep strict verification incomplete for that retained exception; count all findings even when response details are capped.

Discovered in SupportForge issue #266: all 92 mismatches in a 474-record production export exactly reproduced when restoring one undefined property omitted by JSON storage. The other 382 hashes and every predecessor link matched directly. Regression tests cover the writer and ensure unexplained findings beyond the display cap remain urgent.
