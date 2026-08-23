---
tech: nodejs
tags: [npx, sigterm, signals, graceful-shutdown, docker, containers, dumb-init, tsx, deployment]
severity: high
---
# npx does not forward SIGTERM, so the container's graceful shutdown never runs

## PROBLEM

`npx <tool> app.js` is the idiomatic way to invoke a locally-installed binary, and as a
container `CMD` it looks equivalent to running that binary directly. It is not: **npx does not
forward SIGTERM to the process it spawns.** The app's `process.on("SIGTERM", ...)` handler never
fires. The platform sends SIGTERM, nothing happens, the platform waits out its termination grace
period, then SIGKILLs. Every deploy silently skips the drain -- connections are not closed,
spawned child processes are orphaned to the container runtime, and whatever the handler was
supposed to release (tokens, locks, sessions) is not released.

Nothing errors, and all three things you would check to catch it read as normal:

- **No shutdown logs.** The handler never ran, so the app prints nothing on the way out. That is
  indistinguishable from a platform that stops collecting stdout once a container is marked for
  teardown, which many do.
- **The elapsed SIGTERM-to-gone time equals the configured grace period.** That looks like a
  deliberate drain window being used, not a timeout being hit. It is the same number every time,
  which is the actual tell: a real drain finishes in whatever time the work takes and varies.
- **Exit code 143** (128+15). It reads as "terminated by SIGTERM", which is true, and is what a
  great many healthy containers exit with anyway.

A wrapper that *does* forward -- `doppler run --forward-signals`, `tini -g`, a shell that traps
and re-raises -- masks this completely. So the bug appears when you remove that wrapper for an
unrelated reason (dropping a secrets tool, simplifying an entrypoint), and the removal looks
innocent because the layer you deleted was not the one doing the work you noticed.

`dumb-init` does not save you: it delivers to `npx`, and `npx` is where the signal stops.
`--single-child` versus the default process-group broadcast makes no difference to this.

## WRONG

```dockerfile
# The drain handler in app.js never runs. Silent on every deploy.
CMD ["dumb-init", "--single-child", "--", "npx", "tsx", "server.ts"]
```

```js
// This is never reached, and nothing tells you so.
process.on("SIGTERM", async () => {
  console.log("SIGTERM received; draining");
  await closeAllSessions();   // spawned stdio children stay orphaned
  process.exitCode = 0;
});
```

## RIGHT

```dockerfile
# Invoke the binary directly so the signal reaches node.
# Absolute path: npm workspaces hoists binaries to the REPO-ROOT node_modules,
# not the package's, and WORKDIR here is the package.
RUN test -x /app/node_modules/.bin/tsx
CMD ["dumb-init", "--single-child", "--", "/app/node_modules/.bin/tsx", "server.ts"]
```

Measured in a container reproducing each chain exactly (app traps SIGTERM, logs, exits 0):

```
dumb-init --single-child -- npx tsx app.js          NO DRAIN     exit=143
dumb-init                -- npx tsx app.js          NO DRAIN     exit=143
dumb-init --single-child -- ./node_modules/.bin/tsx CLEAN DRAIN  exit=0
dumb-init                -- ./node_modules/.bin/tsx CLEAN DRAIN  exit=0
```

Keep `--single-child` for a server that spawns child processes: without it dumb-init broadcasts
SIGTERM to the whole process group and kills those children directly, instead of letting the
app's drain close them through the sessions that own them.

## NOTES

**Do not verify this with `kill -TERM <npx-pid>` on the host.** It reports the signal being
forwarded, because signalling one PID directly is a different delivery path from a container's
PID 1 supervising its child. This exact false negative cost a debugging cycle: the host test said
"FORWARDED", the container test said `exit=143`. Build a throwaway image with the real chain and
`kill --signal TERM` the container. [process-exit-truncates-shutdown-log.md] already warned about
precisely this ("a layer can pass the first and fail the second, so the local proof is of the
wrong question") -- heed it.

Sibling failure mode: [process-exit-truncates-shutdown-log.md] is the case where the handler DID
run and the evidence was destroyed. This entry is the case where the handler never ran at all.
They present almost identically -- missing shutdown log lines plus an exit code that proves
nothing -- so check which one you have before fixing either. The distinguishing question is
whether the *first* log line of the handler appears: if even that is missing, the signal never
arrived.

Platform grace period is a separate, compounding setting. Railway's teardown `Draining` (the
SIGTERM-to-SIGKILL gap) ships as `0`, which stops the container before any handler could run --
so both this and the platform default must be fixed for a drain to work. Kubernetes'
`terminationGracePeriodSeconds` (default 30) is the equivalent knob.

The same forwarding gap applies to any launcher-shaped wrapper in a `CMD`: prefer `exec`-ing the
real binary, and make the app's own first-line-of-handler log the thing you trust, not the exit
code.
