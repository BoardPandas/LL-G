---
tech: nodejs
tags: [sigterm, signals, graceful-shutdown, npm, docker, railway, pid-1, bullmq, deploys]
severity: high
---
# `npm run` as a container start command swallows SIGTERM, so graceful shutdown never runs

## PROBLEM

`npm run start` (or any `npm run <script>`) as a container start command makes **npm** PID 1. Docker and every platform built on it deliver SIGTERM to PID 1 only. npm does not pass it down to the process it spawned, so your `process.on('SIGTERM')` handler never fires. The app is SIGKILLed at the end of the grace period instead of draining.

This is the same defect as [npx does not forward SIGTERM](npx-does-not-forward-sigterm.md), one wrapper over, but it matters more because `npm run` is the default shape: it is what every scaffolded project puts in its Dockerfile, Procfile, or platform start-command field. `npx` is the exception; `npm run` is the norm.

Every signal reads as fine:

- **The deploy goes green.** The new container is healthy; the old one is what dies badly.
- **Grace-period timing looks like a drain.** SIGTERM-to-gone equals the configured window, which reads as the window being used rather than hit.
- **The shutdown log is absent**, which is indistinguishable from a platform that stops collecting stdout at teardown. (Compounded by [process.exit() discarding the line that proves it](process-exit-truncates-shutdown-log.md), so even a working handler can look broken.)

The cheap tell nobody looks at: **the `pid` field in your own structured logs.** pino, bunyan and winston emit it by default. If your app logs `pid: 137`, it is a grandchild and is not the process being signalled. If it logs `pid: 1`, it is. That one field settles it without a debugger, and it is already in every log line you have shipped.

Two platform-side tells: the outgoing deployment ends in a crashed/errored state rather than a clean removal, and npm prints its own epitaph:

```
npm error path /app
npm error command failed
npm error signal SIGTERM
npm error command sh -c prisma migrate deploy && node server.js
```

That `npm error signal SIGTERM` line **is** the bug, in plain text, on every deploy. It is easy to dismiss as teardown noise.

The cost depends on what the process was doing. For an HTTP server behind an overlap/connection-draining window, the platform covers most of it. For a **queue worker there is no overlap to save you**: BullMQ's `worker.close()` never runs, in-flight jobs are killed rather than drained, the broker marks them stalled, and they are re-run under `attempts: N`. A job that had already issued a non-idempotent side effect (placing an order, charging a card, sending a webhook) does it **again**. A configured 180-second drain window contributes nothing, because nothing is listening for the signal that starts it.

## WRONG

```dockerfile
# Dockerfile / Procfile / platform start-command field
CMD ["npm", "run", "start"]
```

```jsonc
// package.json -- adding `exec` HERE does not fix it.
// npm is still PID 1 and still never forwards the signal.
{ "scripts": { "start": "prisma migrate deploy && exec node server.js" } }
```

```js
// Registered, correct, and never called.
process.on('SIGTERM', async () => {
  await worker.close();     // drains in-flight jobs
  process.exit(0);
});
```

## RIGHT

```dockerfile
# Remove npm from the start path entirely. `exec` replaces the shell,
# so the app becomes PID 1 and is signalled directly.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && exec node server.js"]
```

```bash
# Platform start-command field (Railway, Render, Fly, ...) -- same shape.
# Direct binary paths, because npx has this exact defect too.
./node_modules/.bin/prisma migrate deploy && exec node --import tsx src/worker.ts
```

```jsonc
// Keep the npm script in sync so local and production do not drift,
// but understand it is the platform start command that had to change.
{ "scripts": { "start": "prisma migrate deploy && exec node server.js" } }
```

Confirm with the `pid` field, not by inspection:

```
{"level":"info","pid":1,"msg":"Workers started"}          <- signalled directly
{"level":"info","pid":1,"msg":"Shutting down workers..."} <- handler actually ran
```

## NOTES

**Local testing produces a false negative, and a stronger one than with npx.** `kill -TERM <npm-pid>` on the host *does* reach the child and the handler *does* run, so a local reproduction cleanly "proves" there is no bug. Host PID signalling and PID-1 container supervision are different delivery paths. The only honest test is a real container teardown, read from the platform's own logs.

**A single-command `sh -c` is not the culprit and will mislead you if you test it.** `sh -c "node server.js"` execs the binary directly, so signals arrive fine, and an A/B of `sh -c` with and without `exec` shows no difference. The shell only stays resident for compound commands (`a && b`), and npm is a separate, always-present layer regardless.

**Ordering matters when you fix it:** if a migration must run first, only the *last* command can be `exec`ed. `prisma migrate deploy && exec node server.js` is right; `exec prisma migrate deploy && node server.js` replaces the shell with the migration tool and never starts the app.

**Watch for a silent regression on the way out.** npm injects `npm_package_version`, `npm_package_name` and friends. Dropping npm removes them, so any code reading `process.env.npm_package_version` degrades to `undefined` without erroring. A health endpoint that reports `"version":"unknown"` and still returns 200 is the usual casualty. Read the version from `package.json` instead.

Related: [npx does not forward SIGTERM](npx-does-not-forward-sigterm.md) (same defect, different wrapper), [A working shutdown handler looks broken](process-exit-truncates-shutdown-log.md) (why the absence of a shutdown log proves nothing on its own).
