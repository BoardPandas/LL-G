---
tech: railway
tags: [postgres, volume-backups, restore-drill, snapshots]
severity: medium
---
# Railway volume-backup restore swaps the volume on the live service, so it cannot be drilled safely

## PROBLEM
Restoring a Railway volume backup (`railway postgres pitr backup restore <id>`) mounts a new volume on the same production service and redeploys it. It cannot target another service or environment, so "testing" it means touching production.
The CLI also files these volume snapshots (IDs `vs_...`) under `postgres pitr` (`schedule set`, `backup create`), although they are not pgBackRest and work with PITR disabled. Manual snapshots never expire.

## WRONG
```bash
# "drill" the nightly snapshot
railway postgres pitr backup restore <id> --service Postgres   # restages the live DB
```

## RIGHT
```bash
# Drill with PITR, which restores into a new sibling service
railway postgres pitr restore --service Postgres --at 1h --new-service-name pg-drill
# Keep volume restores for real disasters; delete manual snapshots by hand when due
```

## NOTES
Retention is fixed by Railway: daily 6 d, weekly 27 d, monthly 89 d.
