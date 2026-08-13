---
tech: nodejs
tags: [graceful-shutdown, sigterm, process-exit, stdout-buffering, docker, dumb-init, exit-codes, observability]
severity: high
---
# A working shutdown handler looks broken, because process.exit() discards the line that proves it

## PROBLEM

You add a SIGTERM handler, deploy, and read the logs:

```
[app] SIGTERM received; draining sessions
Process terminated with exit code 143
```

The opening line is there. The closing line is not. The exit code is the signal's, not
yours. Every visible signal says the drain was cut off mid-flight — so you go hunting for
what killed it. **The drain may have completed perfectly.**

`process.stdout` is **asynchronous when it is a pipe**, which is exactly what a container
gives you. `process.exit()` terminates immediately and throws away whatever is still
buffered. The first log survives because time passed before the exit; the last one is
written and discarded microseconds later. The louder your handler is at the end, the more
certain you are that it failed.

Two things compound it, and each independently produces the same wrong conclusion:

**Exit codes get rewritten by whatever wraps you.** `sh -c "cmd"` dies on SIGTERM and
reports 143. `doppler run` (and wrappers like it) signal the child, wait, and then report
their own status — 255. Your `process.exit(0)` never reaches the container runtime, so the
code tells you nothing about your process.

**`kill -TERM <pid>` does not reproduce how the signal actually arrives.** dumb-init
broadcasts to the whole **process group** by default, so every wrapper between PID 1 and
your app is signalled *simultaneously* with it. A local test that signals one PID tests
forwarding down a chain — a real deploy tests whether each wrapper stays alive while you
drain. Those are different questions, and a layer that passes the first can fail the second.
A verification built on the wrong one reads as proof and isn't.

And `sh -c "start || fallback"` can never `exec`: the shell must survive to run the `||`
branch, so the shell is the supervised process, and shells do not forward SIGTERM — they
just die, and PID 1 tears the container down while your handler is still running.

## WRONG

```js
const shutdown = async (signal) => {
  console.log(`[app] ${signal} received; draining`);
  server.close();
  const closed = await closeAllSessions();
  console.log(`[app] closed ${closed} session(s); exiting`);  // written, then discarded
  process.exit(0);                                            // <- kills the pending write
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
```

```dockerfile
# The shell must outlive the app to run `||`, so the SHELL is what PID 1 waits on.
CMD ["dumb-init", "sh", "-c", "start-with-secrets || start-without"]
```

```bash
# "Proves" forwarding works. Does not reproduce a process-group broadcast.
sh -c "exec wrapper app.js" & kill -TERM $!
```

## RIGHT

```js
const shutdown = async (signal) => {
  console.log(`[app] ${signal} received; draining`);
  stopTimers();                    // clear intervals BEFORE tearing state down
  server.close();
  // Idle keep-alive sockets (health probes) hold the loop open forever; without this the
  // process never exits on its own and every clean drain hits the backstop instead.
  server.closeIdleConnections();

  const closed = await closeAllSessions();
  console.log(`[app] closed ${closed} session(s); exiting`);

  // Set the code and let the event loop empty. Flushes stdout, and the process reports
  // its OWN status instead of one inherited from being killed.
  process.exitCode = 0;
};

process.on("SIGTERM", () => {
  const t = setTimeout(() => { console.error("[app] drain timed out"); process.exit(1); }, 8000);
  t.unref();                       // a backstop must not itself pin the loop open
  void shutdown("SIGTERM");
});
```

```dockerfile
# Decide the fallback BEFORE exec, so the app is the process PID 1 waits on.
# --single-child delivers to the direct child and lets each layer hand the signal down,
# instead of broadcasting to the group where a wrapper can exit before you finish draining.
CMD ["dumb-init", "--single-child", "--", "sh", "-c", \
     "if probe-secrets >/dev/null 2>&1; then exec start-with-secrets; else exec start-without; fi"]
```

## NOTES

- **Trust an application-level log line, never the exit code.** `closed N session(s); exiting`
  is yours and says what happened; the exit code passes through processes that will overwrite
  it. Design the handler so its success and failure paths each print something distinct.
- **Verify with the real process tree.** Extract the actual `CMD` string from the Dockerfile
  and run *that*, rather than a retyped approximation — a paraphrase drifts from what ships.
  Parsing it out of the file is three lines and removes the doubt.
- Symptom sequence worth recognising, all from one service: exit 143 with no drain line
  (shell was supervised) → exit 143 with the drain line but no completion (stdout truncated)
  → completion line present, exit 255 (a wrapper rewriting the code). Only the third is
  healthy, and it is the one that still *looks* wrong.
- The idle-socket detail is not optional. Switching to `process.exitCode` without releasing
  keep-alives converts "log line missing" into "every shutdown hits the timeout" — a
  different wrong answer.
- Related: `unregistered-kickoff-timer-survives-shutdown.md` and
  `leaked-exit-timer-masks-test-hang.md` (timers outliving shutdown), and
  `kb/mcp/session-and-child-leak-without-delete.md` (why the drain existed at all).
