---
tech: railway
tags: [postgres, pitr, security, restore-drill, tcp-proxy]
severity: high
---
# A Railway PITR-restored service gets a public TCP proxy and a read-write archive credential

## PROBLEM
A sibling service created by `railway postgres pitr restore` comes up with a public TCP proxy and `WAL_RECOVER_FROM_*` variables holding a read-write credential to the source's archive bucket.
A "harmless" drill restore is therefore a public endpoint to a full copy of production, plus write access to the archive. Two smaller traps: its private hostname is a generated label (for example `postgres-2108`), not the service name, and a delete reports success about a minute before it applies.

## WRONG
```bash
railway postgres pitr restore --service Postgres --at 1h --new-service-name pg-drill
# leave it running "for later"; point a cutover at pg-drill.railway.internal
```

## RIGHT
```bash
# Use it, then delete it the same day. delete-service detaches the volume: delete that too
# Re-read the environment until both are gone (a staged patch applies about a minute later)
# For a real cutover, read networking.privateNetworkEndpoint from describe-service
# and use <endpoint>.railway.internal
```

## NOTES
The restored database keeps the source's role passwords, because they are in the restored catalog. The restored service does not archive, so after a cutover enable PITR and snapshot schedules on it again.
