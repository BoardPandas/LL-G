---
tech: typescript
tags: [drizzle-kit, migration, metadata, snapshot, journal, schema]
severity: high
---
# drizzle-kit generate aborts with a snapshot-chain collision on duplicate id/prevId

## PROBLEM
`drizzle-kit generate` (and `migrate`) maintains a linear chain of snapshot files in `drizzle/meta/NNNN_snapshot.json`. Each snapshot carries an `id` (its own identity) and a `prevId` (the `id` of the snapshot before it). The chain must be strictly linear: every snapshot's `prevId` points at exactly one parent, and no two snapshots share an `id`.

When two or more snapshots end up with the same `id` (and therefore the same `prevId`), drizzle-kit sees a fork in the chain and aborts with:

```
... are pointing to a parent snapshot: drizzle/meta/0078_snapshot.json/snapshot.json which is a collision
```

This happens easily when migrations are hand-authored or copy-pasted: a developer duplicates an existing `NNNN_snapshot.json` as a starting point for a new migration and forgets to regenerate the `id`/`prevId`, so several snapshots inherit identical values. The command fails before generating anything, and the message points at the *parent* snapshot, not the duplicated children, so it is easy to misread which files are actually broken.

## WRONG
```jsonc
// 0078_snapshot.json
{ "id": "44b45137-95b8-47ec-bd78-ac1f4879df8d", "prevId": "62f712e5-...", ... }

// 0079_snapshot.json  (copied from 0078, ids never changed)
{ "id": "44b45137-95b8-47ec-bd78-ac1f4879df8d", "prevId": "62f712e5-...", ... }

// 0080_snapshot.json  (also copied)
{ "id": "44b45137-95b8-47ec-bd78-ac1f4879df8d", "prevId": "62f712e5-...", ... }
// -> three snapshots share one id/prevId => "collision", generate aborts
```

## RIGHT
```jsonc
// Re-link into a strictly linear chain: each id is unique and each
// prevId equals the previous snapshot's id.
// 0077.id == 0078.prevId, 0078.id == 0079.prevId, etc.

// 0078_snapshot.json
{ "id": "44b45137-95b8-47ec-bd78-ac1f4879df8d", "prevId": "62f712e5-e339-42e1-8abd-52912e956e36", ... }

// 0079_snapshot.json
{ "id": "bf94207d-...", "prevId": "44b45137-95b8-47ec-bd78-ac1f4879df8d", ... }

// 0080_snapshot.json
{ "id": "dbda0c48-...", "prevId": "bf94207d-...", ... }

// 0081_snapshot.json
{ "id": "9c4f8a21-...", "prevId": "dbda0c48-...", ... }
```

To repair: confirm `0077.id` matches `0078.prevId`, then walk forward giving each snapshot a fresh unique `id` and setting the next snapshot's `prevId` to it. Two snapshots may have byte-identical *table definitions* (a data-only migration legitimately changes no schema) -- that is fine; only the `id`/`prevId` metadata must be unique and correctly linked.

## NOTES
- Edit the snapshot JSON with a tool that preserves the existing line endings (LF). Rewriting LF to CRLF turns a 3-line metadata fix into a whole-file diff that is impossible to review.
- After repairing, run `drizzle-kit generate`. A clean chain reports "No schema changes, nothing to migrate" (assuming the schema itself is unchanged).
- A *separate* failure mode looks similar but has a different cause: if `generate` proposes a spurious `DROP TABLE` for a table you still use, the schema file is simply missing from the `schema: [...]` array in `drizzle.config.ts`. See [drizzle-kit-schema-not-in-config.md](drizzle-kit-schema-not-in-config.md).
- Related ordering gotcha: [drizzle-kit-migrate-silent-skip.md](drizzle-kit-migrate-silent-skip.md) (migrations skipped when the `when` timestamp in `_journal.json` is below the existing ceiling). If you hand-author a journal entry while fixing snapshots, bump its `when` above the highest existing value too.
