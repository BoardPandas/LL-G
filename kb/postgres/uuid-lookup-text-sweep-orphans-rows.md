---
tech: postgres
tags: [uuid, case-sensitivity, polymorphic, text, delete, orphans]
severity: high
---
# A case-insensitive UUID lookup plus a TEXT polymorphic sweep orphans child rows

## PROBLEM
The parent row is found through a UUID comparison (case-insensitive: `'ABC...'::uuid = 'abc...'::uuid`), so an upper-cased id passed by a caller resolves fine. But polymorphic child tables keyed by `(entity, entity_id TEXT)` (notes, tasks, comments, custom-field values) are swept with `entity_id = $1` as text, which is case-sensitive. Deleting with the upper-cased id removes the parent and leaves every child behind as an orphan, and a "what will be deleted" preview using the same predicate reports zero children.

## WRONG
```ts
const deal = await getDeal(tx, mspId, args.id);           // uuid compare: found
await tx.query(`DELETE FROM crm_notes WHERE msp_id=$1 AND entity='deal' AND entity_id=$2`, [mspId, args.id]); // text: matches nothing
await tx.query('DELETE FROM crm_deals WHERE id=$1', [args.id]);
```

## RIGHT
```ts
const deal = await getDeal(tx, mspId, args.id);
const id = deal.id;                                       // canonical form, as the database stores it
await tx.query(`DELETE FROM crm_notes WHERE msp_id=$1 AND entity='deal' AND entity_id=$2::text`, [mspId, id]);
await tx.query('DELETE FROM crm_deals WHERE id=$1', [id]);
```

## NOTES
After the first read, use the id the database returned for every write, count, audit row and response, never the caller-typed one. Applies to any TEXT column holding UUIDs. Test with an id containing hex letters (see jest/case-tests-vacuous-with-digit-ids).
