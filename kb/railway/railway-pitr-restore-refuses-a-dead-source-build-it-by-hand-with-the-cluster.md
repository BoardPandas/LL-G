---
tech: railway
tags: [postgres, pitr, pgbackrest, restore, disaster-recovery]
severity: high
---
# Railway PITR restore refuses a dead source; build it by hand with the cluster path and pgBackRest time format

## PROBLEM
`railway postgres pitr restore` fails with "Couldn't read the source database's backups" when the source's host is dead, because its pre-flight reads the catalog through the source container.
You can build the restore by hand: a new service on the same `postgres-ssl:<major>` image with an empty volume, the source's variables, the `WAL_ARCHIVE_*` values copied as `WAL_RECOVER_FROM_*`, and `POSTGRES_RECOVERY_TARGET_TIME`. Two traps both surface only as the image's generic "couldn't read the archive".

## WRONG
```bash
WAL_RECOVER_FROM_PATH=/pgbackrest                 # same as WAL_ARCHIVE_PATH -> pgBackRest 075, "backup.info missing"
POSTGRES_RECOVERY_TARGET_TIME=2026-01-01T12:00:00Z  # ISO form -> pgBackRest 029
```

## RIGHT
```bash
# The image archives into a cluster-<system-identifier> subdir; take it from the source's
# "pgbackrest: using repo1-path=..." log line
WAL_RECOVER_FROM_PATH=/pgbackrest/cluster-<sysid>
POSTGRES_RECOVERY_TARGET_TIME="2026-01-01 12:00:00+00"
```

## NOTES
- The restored service's variables are references to the OLD service (`${{Postgres.POSTGRES_PASSWORD}}`, `PGDATA`, ...).
  - Before deleting the old service, copy them onto the new service as plain values: GraphQL `variableCollectionUpsert` with `skipDeploys: true`.
  - Skip that, and the next restart comes up with blank credentials, which breaks every app whose DATABASE_URL references the new service.
- Enabling PITR on the restored service restarts it.
  - Its first full backup (`--start-fast`) plus a cold cache caused DB timeouts for several minutes afterwards.
  - Schedule it off-peak.
