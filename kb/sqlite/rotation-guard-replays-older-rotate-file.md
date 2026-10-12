---
tech: sqlite
tags: [idempotency, token-rotation, sql-scripts, replay, ordering, d1, security]
severity: high
---
# A token rotation guarded only by "hash differs" lets an older rotate file restore a retired token

## PROBLEM
A generated rotate script guarded with `WHERE token_hash <> :new_hash` looks idempotent, since re-running it changes nothing. But an **older** rotate file applied after a newer one also passes the guard (its hash differs from the current one), and silently puts back a bearer token the later rotation retired. There is no error, and an audit insert gated on the change being visible records it as a normal rotation.

## WRONG
```sql
UPDATE principals SET token_hash = :new_hash
WHERE id = :id AND token_hash <> :new_hash;
```

## RIGHT
```sql
-- :file_time is fixed once, when the file is generated
UPDATE principals SET token_hash = :new_hash, rotated_at = :file_time
WHERE id = :id AND revoked_at IS NULL
  AND (rotated_at IS NULL OR rotated_at < :file_time);
```

## NOTES
- `toISOString()` text compares in time order, because every value has the same width and the `Z` zone.
- Test: generate file A, then file B; apply B, then A, and assert B's hash is still current. Also apply B twice.
- Pair it with a guard statement that fails loudly when the WHERE matches nothing, so a stale file is reported instead of skipped.
- Related: `audit-insert-gated-on-visible-change-repeats.md`. Verified on D1, 2026-10-12.
