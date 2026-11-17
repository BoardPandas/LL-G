---
tech: postgres
tags: [pgbackrest, railway, postgres-ssl, restore, wal-archive, failback]
severity: high
---
# A database restored by the postgres-ssl image keeps the source's pgBackRest repo-path marker, which overrides WAL_ARCHIVE_PATH

## PROBLEM
Railway's `postgres-ssl` image records the pgBackRest repo path it archives to in a marker file, `$PGDATA/.pgbackrest_repo_path`. When the image starts, that marker wins over `WAL_ARCHIVE_PATH`.
A pgBackRest restore rebuilds `$PGDATA` from the source's backup, and the marker comes with it. So a restored copy you configured to archive to a NEW path keeps archiving into the SOURCE's path.

Nothing reports it:
- archiving succeeds, because the copy's segments are written somewhere;
- the timeline switch at the end of recovery gives the copy's WAL segments different names from the source's, so the two do not overwrite each other;
- the variable shows the new path, so a check that reads only the variable agrees with your intent.

The configured path receives nothing. A later restore or point-in-time recovery from that path finds an empty repo.

## WRONG
```bash
# On the restored service: set a new archive path and trust the variable
WAL_ARCHIVE_PATH=/pgbackrest/<new-path>
# variables list shows the new path -- proves nothing about where WAL actually goes
```

## RIGHT
```bash
# After any restore, inside the container, read what the image will really use
cat "$PGDATA/.pgbackrest_repo_path"   # still the source's path after a restore
# ...and the rendered repo1-path in the generated pgBackRest config,
# or the image's "pgbackrest: using repo1-path=..." log line
```
To fail back to the original service, restore from the path the copy actually archived to, which is the marker's path, not the `WAL_ARCHIVE_PATH` it was given.

## NOTES
- Setting only the variable does nothing while the marker exists. Read the image's entrypoint for how it writes the marker before you change it.
- The overlap was harmless here, because timelines keep segment names apart. But a repo holding two clusters' WAL is not what anyone will expect when they come to restore from it.
- Related, on the railway shelf: `railway-pitr-restore-refuses-a-dead-source-build-it-by-hand-with-the-cluster` (the `cluster-<sysid>` subdirectory and the `repo1-path` log line).
