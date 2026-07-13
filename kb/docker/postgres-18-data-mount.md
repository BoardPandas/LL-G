---
tech: docker
tags: [postgres, postgres-18, volume, mount, pgdata, compose, crash-loop]
severity: high
---
# postgres:18 image rejects the classic /var/lib/postgresql/data mount

## PROBLEM
For years the canonical way to persist the official `postgres` image was to mount a volume at `/var/lib/postgresql/data`. The `postgres:18` image CHANGED this: it now stores data in a major-version subdirectory and expects the volume mounted one level up at `/var/lib/postgresql`. If you mount at the old `/var/lib/postgresql/data`, the container immediately exits (crash-loops) with an error about data in "an unused mount/volume" and a pg_ctlcluster / major-version-specific-directory explanation. Copy-pasting a working pre-18 compose file silently breaks the instant you bump the image tag to 18.

## WRONG
```yaml
services:
  db:
    image: postgres:18
    volumes:
      - pgdata:/var/lib/postgresql/data   # 18+ rejects this -> crash loop
```

## RIGHT
```yaml
services:
  db:
    image: postgres:18
    volumes:
      - pgdata:/var/lib/postgresql        # data lands in /var/lib/postgresql/18/docker
```

## NOTES
`pg_dump`/`pg_restore`/`psql` don't care about the on-disk path, so restores and healthchecks (`pg_isready -U postgres`) work unchanged. The change exists to make `pg_upgrade --link` work across major versions without mount-point boundary issues. If you already created a volume with the old layout, delete it and recreate with the new mount point (an empty cluster re-inits cleanly).
