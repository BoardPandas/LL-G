---
tech: sqlite
tags: [idempotency, audit-log, sql-scripts, rerun, d1, wrangler]
severity: high
---
# An audit row gated on "the change is visible" is written again when the script re-runs

## PROBLEM
A generated SQL file meant to be safe to re-run (applied by hand, e.g. `wrangler d1 execute --file`) often writes its audit row only "if the change actually happened": `INSERT INTO audit_log ... SELECT ... WHERE EXISTS (row in the new state)`. The UPDATE is idempotent, but that guard is not: on a second run the new state is still visible, so the audit row is inserted again. The log now records two revocations or rotations that happened once, with no error.

## WRONG
```sql
UPDATE principals SET revoked_at = '2026-10-12T10:00:00.000Z'
WHERE id = 'p-1' AND revoked_at IS NULL;

INSERT INTO audit_log (at, actor, action, target)
SELECT '2026-10-12T10:00:00.000Z', 'admin', 'principal.revoke', 'p-1'
WHERE EXISTS (SELECT 1 FROM principals WHERE id = 'p-1' AND revoked_at = '2026-10-12T10:00:00.000Z');
```

## RIGHT
```sql
INSERT INTO audit_log (at, actor, action, target)
SELECT '2026-10-12T10:00:00.000Z', 'admin', 'principal.revoke', 'p-1'
WHERE EXISTS (SELECT 1 FROM principals WHERE id = 'p-1' AND revoked_at = '2026-10-12T10:00:00.000Z')
  AND NOT EXISTS (SELECT 1 FROM audit_log
                  WHERE action = 'principal.revoke' AND target = 'p-1'
                    AND at = '2026-10-12T10:00:00.000Z');
```

## NOTES
- The file's generation time is its identity: write it once, and use that same `at` in every statement of the file.
- Test by applying the same file twice and asserting exactly one audit row.
- Related: `rotation-guard-replays-older-rotate-file.md`. Verified on D1, 2026-10-12.
