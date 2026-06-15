---
tech: nextjs
tags: [nextjs, docker, kubernetes, health-checks, standalone, deployment, northflank]
severity: high
---
# Next.js standalone server binds to process.env.HOSTNAME, breaking container health probes

## PROBLEM
A Next.js app built with `output: 'standalone'` runs via `node server.js`, which
binds the HTTP server to `process.env.HOSTNAME || '0.0.0.0'`. In a container or
Kubernetes runtime, HOSTNAME is set to the pod/container name (e.g.
`dashboard-9964b7488-88n52`), so the server binds to that hostname instead of all
interfaces.

External ingress/load-balancer traffic still works because it targets the pod IP,
which masks the bug completely: `curl` of the health endpoint from outside returns
200. But the platform's internal liveness/readiness probe cannot reach the server
at the pod name. With an HTTP liveness probe enabled, the probe fails every cycle,
the orchestrator kills the container, and it enters a restart loop roughly every
`initialDelay + period * failureThreshold` seconds.

Symptoms that look contradictory: external curl of the health route returns 200,
the app logs "Ready" repeatedly at a fixed interval, the deployment shows
"0/1 passing" with a rising restart count, even though the route handler itself is
fine. The route is never the problem; the bind address is.

## WRONG
```dockerfile
FROM node:24-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
EXPOSE 3000
# No HOSTNAME set: standalone binds to $HOSTNAME, which the runtime sets to the
# pod name. External ingress works, internal health probe cannot connect.
CMD ["node", "server.js"]
```

## RIGHT
```dockerfile
FROM node:24-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
EXPOSE 3000
# Next.js standalone binds to process.env.HOSTNAME; in a container that defaults
# to the pod name, so the platform health probe can't reach the server even
# though external ingress can. Bind to all interfaces explicitly.
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

## NOTES
Set `ENV HOSTNAME="0.0.0.0"` (and `ENV PORT=<port>`) in the runner stage BEFORE
enabling any HTTP health check on a Next.js standalone service. Do it
preemptively even if you have no probe yet, so adding one later doesn't trigger a
restart loop.

Discovered while configuring Northflank HTTP liveness probes for two Next.js
services: the one whose Dockerfile already had `HOSTNAME=0.0.0.0` passed
immediately; the one missing it restart-looped despite returning 200 to external
curl. Applies to any orchestrator that probes by pod name/internal address
(Kubernetes, Northflank, Nomad).

This is distinct from `dev-ignores-port-env.md` (which is about `next dev`/`next
start` ignoring PORT/HOSTNAME env vars in favor of CLI flags). Here it is the
opposite: the standalone production `server.js` DOES honor the env var, and that
is exactly what bites you when the runtime pre-sets HOSTNAME to the pod name.
