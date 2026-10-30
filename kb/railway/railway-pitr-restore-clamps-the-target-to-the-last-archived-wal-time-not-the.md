---
tech: railway
tags: [postgres, pitr, pgbackrest, restore, backups]
severity: high
---
# Railway PITR restore clamps the target to the last archived WAL time, not the time you asked for

## PROBLEM
`railway postgres pitr restore --at T` recovers to the source's `archiverLastArchivedAt` at request time when that is earlier than T, even though `pitr status` shows a later `maxRestoreTime` and the CLI's JSON echoes T back.
We asked for 18:35:51. The restored service's `POSTGRES_RECOVERY_TARGET_TIME` was 18:35:25.6, the last archive time, so the 25 seconds of commits in between were silently left out.

## WRONG
```bash
railway postgres pitr restore --service Postgres --at 2026-01-01T12:00:00Z --json
# targetTimestamp echoes 12:00:00 -> assume the restore is at 12:00:00
```

## RIGHT
```bash
# 1. Wait until the archiver has passed T
railway postgres pitr status --service Postgres --json | jq .live.archiverLastArchivedAt
# 2. Restore, then confirm the real target on the new service
railway postgres pitr restore --service Postgres --at 2026-01-01T12:00:00Z
#   POSTGRES_RECOVERY_TARGET_TIME variable on the restored service
#   log line: "recovery stopping before commit of transaction ..., time ..."
```

## NOTES
Matters most for "restore to just before the bad write" in the last minute or two. With `archive_timeout = 60` the gap is under about a minute.
