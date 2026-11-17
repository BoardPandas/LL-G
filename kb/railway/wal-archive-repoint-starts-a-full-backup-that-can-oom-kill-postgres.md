---
tech: railway
tags: [postgres, pgbackrest, postgres-ssl, wal-archive, backup, oom, memory-limit]
severity: high
---
# Repointing WAL archiving at an empty pgBackRest repo starts a full backup that can OOM-kill Postgres

## PROBLEM
Railway's `postgres-ssl` image runs a backup watcher beside Postgres. When its catalog check finds no full backup in the configured repo, it takes one.
So repointing the `WAL_ARCHIVE_*` variables at a new, empty pgBackRest repo starts a full backup about 30 minutes later. Nothing in the variable change says a backup will run.

The image sizes that backup from the vCPUs it can see, not from the memory limit. On a service that saw 32 vCPU and was capped at 2 GB, backup `process-max` auto-detected as 8:
- the parallel backup pushed the container past its memory cap;
- the OOM killer took the Postgres checkpointer, and the database spent about 2 minutes in crash recovery;
- before that, app queries were already hitting their statement timeouts while the backup read the data directory.

The change looks like a config edit. The cost lands half an hour later and looks like an unrelated crash.

## WRONG
```text
Service:  2 GB memory limit, 32 vCPU visible, process-max left to auto-detect
10:00     WAL_ARCHIVE_* repointed at a new, empty repo, during business hours
~10:30    watcher: no full backup in the catalog -> full backup, process-max 8
          -> memory over 2 GB -> OOM killer takes the checkpointer
          -> ~2 min crash recovery; statement timeouts in the app before it
```

## RIGHT
```text
1. Raise the service's memory limit first. Railway applies a limit change live,
   without a redeploy, so this costs nothing.
2. And/or set PGBACKREST_BACKUP_PROCESS_MAX low (e.g. 2), so backup memory no
   longer scales with the vCPU count the container happens to see.
3. Repoint WAL_ARCHIVE_* off-peak, and expect a full backup within ~30 minutes.
4. Watch the memory graph until that backup finishes, then confirm it is in the
   new repo's catalog.
```

## NOTES
- A full backup on a fresh repo is the intended behaviour, and the point-in-time chain needs it. The trap is its timing and its parallelism, not the backup itself.
- Lowering the memory limit again afterwards brings the risk back for the next full backup the watcher decides to take.
- Related: `railway-pitr-restore-refuses-a-dead-source-build-it-by-hand-with-the-cluster` (the first full backup after enabling PITR also caused timeouts) and `a-railway-bucket-credential-reset-silently-breaks-postgres-wal-archiving-and`.
