---
tech: railway
tags: [postgres, host-failure, outage, diagnosis, sslrequest]
severity: high
---
# A Postgres on a failed Railway host accepts TCP but never answers the handshake, while metrics look healthy

## PROBLEM
When the Railway host under a Postgres service fails, new connections hang forever, while metrics, WAL archiving and already-open pooled connections keep working.
TCP connects succeed because the kernel accepts them, but the server never answers the Postgres handshake, and nothing is logged. A port check says OPEN, and services holding old connections look healthy, so the database gets blamed on the app. Railway's own agent may call the service "healthy".

## WRONG
```bash
# "Port is open, so Postgres is fine"
timeout 5 bash -c 'exec 3<>/dev/tcp/postgres.railway.internal/5432' && echo OPEN
```

## RIGHT
```bash
# From another service you can `railway ssh` into: send an SSLRequest and wait for 1 byte ('S' or 'N')
timeout 8 bash -c 'exec 3<>/dev/tcp/postgres.railway.internal/5432 &&
  printf "\x00\x00\x00\x08\x04\xd2\x16\x2f" >&3 && head -c1 <&3' || echo "WEDGED: no handshake reply"
```
Confirming signs that the host, not Postgres, is at fault:
- `railway ssh` fails only for services on that host ("An error occurred connecting to your service").
- `restart-service` returns `stacker <host> unavailable: keepalive ping failed`.
- Redeploys of the volume-backed service hang, because the old deployment is stuck REMOVING.

## NOTES
Restart and redeploy cannot reach a host the orchestrator has lost. Recover by PITR-restoring into a new service and repointing DATABASE_URL, and open a Railway support ticket naming the host. See the companion entry on restoring PITR by hand when the source is dead.
