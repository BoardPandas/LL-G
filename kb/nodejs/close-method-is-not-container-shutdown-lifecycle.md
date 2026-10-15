---
tech: nodejs
tags: [sigterm, sigint, pid-1, docker, shutdown, child-process, flock, persistent-storage]
severity: high
---
# A close method is not a container shutdown lifecycle

## PROBLEM

A Node HTTP service had a tested `store.close()` method that stopped recorders and disposed its maintenance timer. Nothing in the production entry point called it on `SIGTERM` or `SIGINT`. Normal HTTP and game smoke tests passed, but the actual idle Linux container did not stop on `SIGTERM`: after its ten-second stop timeout, the runtime used `SIGKILL`.

The service already ran through `exec node /app/server.mjs` as PID 1. There was no npm/npx wrapper to remove. This was verified in the tested Node 22 container image; it is not a claim that every Node version or host process ignores the same signal. Reaching Node directly and having a cleanup method are each insufficient to prove that the application's shutdown lifecycle is connected and correct.

The service also owned a private persistent spool used by Java children. Releasing its ownership marker as soon as the HTTP parent began shutting down could admit a replacement while an accepted child was still writing. A successful health check or a unit test that directly calls `close()` exercises neither failure.

## WRONG

```js
const store = new DiagnosticStore();
await store.start();
server.listen(port);
// Tests call store.close(); production never connects it to termination.
```

```js
// Wiring a signal is still insufficient if it abandons accepted work.
process.on("SIGTERM", async () => {
  await store.releaseOwnership();
  process.exit(0); // HTTP requests and writing descendants may still be active.
});
```

## RIGHT

Install an idempotent lifecycle at the actual executable entry point. Close admissions synchronously, stop the optional recorder without killing the underlying job, dispose timers, and drain accepted HTTP/child work before releasing application ownership. Let the event loop exit naturally once those resources are closed.

```js
// Sketch: store/workers methods express application-specific lifecycle contracts.
let draining = false;
let stopping;

function shutdown(signal) {
  if (stopping) return stopping;
  draining = true; // Request/job admission must check this before dispatch.
  store.beginClosing(signal); // Synchronously fence admission and new timers.
  stopping = (async () => {
    const httpDrained = new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolve();
      });
      server.closeIdleConnections();
    });
    await store.stopRecording({ releaseOwnership: false });
    await Promise.all([httpDrained, workers.whenIdle()]);
    await store.close();
    // No process.exit(): allow pending output and child handles to drain.
  })().catch((error) => {
    process.exitCode = 1;
    console.error("Shutdown failed; do not declare ownership released", error);
  });
  return stopping;
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
```

Install handlers before asynchronous startup. Startup completion must respect the closing state instead of reopening admission or creating a timer after shutdown. Fence the gap between admission and controller registration too: a controller attached after shutdown must receive the stop request immediately, including when its child attaches later. Repeated signals must share the same shutdown operation.

For shared persistent storage, process IDs are not sufficient proof of sole ownership across container PID namespaces. In the verified Linux design, an exclusive kernel `flock` on the spool directory inode remained held through an inherited descriptor in **every process that could write**. Node explicitly passed descriptor 9 to the Java child using the child's `stdio` mapping. The Java process verified that the descriptor matched the expected directory device/inode and carried the exclusive lock before enabling capture.

The lock follows the shared open file description. Do not explicitly unlock it while a writing descendant still uses that description; closing the parent's copy alone must not remove the child's protection. Avoid giving the descriptor to unrelated helpers, which could keep the lock alive forever. If parent loss can leave a writer running, a replacement must remain excluded until that writer exits.

## NOTES

- Verify the production entry point in a real container: idle `SIGTERM` and `SIGINT`, an active request, shutdown during startup, and shutdown after admission but before child/controller attachment. Assert the exit status and absence of a timeout/SIGKILL fallback, not merely disappearance of the container. The corrected idle `SIGTERM` probe exited **0**.
- Separately test lock lifetime with an actual writing-runtime child. The verified test kept a small container init alive, exited the Node parent, proved that the surviving JVM still held the directory lock, rejected a second container sharing the volume, and admitted a replacement only after the JVM exited. This deliberately tests parent loss with a surviving child; it does not claim descendants survive a PID-namespace init exit.
- Recorder shutdown, lease expiry, or unavailable native capture support must not terminate an otherwise valid game/job. The underlying job's cancellation policy and the container runtime's finite termination grace period are separate decisions.
- A cleanup error must remain visible and must not turn into a false "safe to replace" claim. Do not use `process.exit(0)` to hide an undrained handle or failed ownership transition.
- Related: [npm does not forward SIGTERM](npm-run-does-not-forward-sigterm.md) and [npx does not forward SIGTERM](npx-does-not-forward-sigterm.md) cover wrapper delivery failures; this case already ran Node directly. [Unregistered kickoff timers survive shutdown](unregistered-kickoff-timer-survives-shutdown.md) covers timer ownership, and [process.exit truncates shutdown logging](process-exit-truncates-shutdown-log.md) explains why immediate exit can erase the evidence.
