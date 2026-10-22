---
tech: railway
tags: [postgres, pgbackrest, wal, pitr, buckets, incident]
severity: high
---
# A Railway bucket-credential reset silently breaks Postgres WAL archiving and fills the disk

## PROBLEM
When Railway resets a bucket's credentials, a Postgres service that archives WAL to that bucket keeps running with the old keys and every archive push fails, so `pg_wal` grows until the volume is full.
Nothing alerts: the database stays healthy, queries work, and the only signals are `archive command failed` / `SignatureDoesNotMatch` (403) lines in the Postgres logs and a slowly rising disk. Point-in-time recovery also stops at the last successful push. The fix is a Postgres redeploy so the container re-reads the new keys, which may be blocked by the same incident that caused the reset (e.g. a platform-wide deploy pause).

## WRONG
```text
# Bucket keys reset by the provider during an incident.
# Assumed: "the database is up, so backups are fine."
# Reality: pgBackRest archive-push fails every segment; pg_wal grows by the daily WAL volume.
```

## RIGHT
```text
1. After any bucket-credential reset, search Postgres logs for
   "archive command failed" OR "SignatureDoesNotMatch".
2. Watch DISK_USAGE_GB on the Postgres service; compute days to full
   from daily WAL volume.
3. Make sure WAL_ARCHIVE_KEY / WAL_ARCHIVE_SECRET are references to the
   bucket's variables, not pasted literals, then redeploy Postgres.
4. If deploys are blocked and the disk is close to full, as a last resort:
   ALTER SYSTEM SET archive_command = '/bin/true'; SELECT pg_reload_conf();
   (gives up PITR for the gap; revert with ALTER SYSTEM RESET after the redeploy)
```

## NOTES
Confirm success afterwards with `archive-push command end: completed` in the logs and a falling disk. If the archive keys are literals, a redeploy alone keeps the dead keys: paste the new ones from the bucket's Credentials tab first.
