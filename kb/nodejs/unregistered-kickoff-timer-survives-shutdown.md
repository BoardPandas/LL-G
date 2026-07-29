---
tech: nodejs
tags: [timers, settimeout, setinterval, graceful-shutdown, cron, jest, open-handles, ci-hang, unref]
severity: high
---
# A job's one-shot kickoff timer outlives graceful shutdown unless it joins the interval's registry

## PROBLEM
The usual "run shortly after boot, then on a schedule" job arms two timers: a one-shot
`setTimeout` kickoff and a recurring `setInterval`. It is easy to register only the
interval for cancellation -- the interval is the one already held in a variable, and the
`setTimeout` reads as fire-and-forget.

It is not. Until it fires, a pending `setTimeout` is a live handle, and shutdown cannot
cancel what it was never handed. Two failures follow, and neither one names the timer:

1. **Production.** Cleanup clears the intervals, closes Redis and ends the DB pool -- and
   then an unregistered kickoff fires into that dead state and starts a job against closed
   connections. It only reproduces if the process is stopped inside the kickoff window, so
   an ordinary restart never shows it.
2. **CI.** Under Jest the kickoff outlives the test file that armed it. Locally you get
   "A worker process has failed to exit gracefully and has been force exited" and still
   exit 0; on a runner the main process never exits at all. Either way the suite is fully
   green, so the failure is attributed to no test and no file.

`clearInterval` vs `clearTimeout` is a red herring: in Node they are interchangeable and
either one cancels either kind of handle. The bug is the missing `push`, not the wrong
`clear`.

## WRONG
```js
export const cronTimerHandles = [];

export function clearCronTimers() {
  for (const h of cronTimerHandles) clearInterval(h);
  cronTimerHandles.length = 0;
}

export function startBackfill() {
  // Fire-and-forget? No -- a live handle nothing can cancel.
  setTimeout(() => { runJob().catch(() => {}); }, 30_000);

  const timer = setInterval(() => { runJob().catch(() => {}); }, intervalMs);
  timer.unref();
  cronTimerHandles.push(timer);   // only the interval is registered
}
```

## RIGHT
```js
export const cronTimerHandles = [];

export function clearCronTimers() {
  // clearTimeout cancels interval handles too -- one call covers both kinds.
  for (const h of cronTimerHandles) clearTimeout(h);
  cronTimerHandles.length = 0;
}

export function startBackfill() {
  const kickoff = setTimeout(() => { runJob().catch(() => {}); }, 30_000);
  kickoff.unref();
  cronTimerHandles.push(kickoff);

  const timer = setInterval(() => { runJob().catch(() => {}); }, intervalMs);
  timer.unref();
  cronTimerHandles.push(timer);
}
```

## NOTES
- Make the registry the rule, not the variable: every timer a `start*` function arms gets
  pushed, kickoffs included. Grep for `setTimeout(` in any module that owns a timer
  registry -- each hit that is not assigned and pushed is this bug.
- `.unref()` on the kickoff matches whatever the sibling interval already does and is
  correct for cron work (in production the listening server keeps the loop alive anyway),
  but **unref alone is not the fix**. It silences the Jest hang while leaving the shutdown
  race fully intact. Register first; unref for consistency.
- Do not reach for `jest --forceExit` to make the hang go away. It is a fine temporary
  unblock -- results are already in by the time it takes effect -- but it converts a real
  resource leak into an invisible one.
- **Bisecting the hang.** `--detectOpenHandles` implies `--runInBand`, so on a large suite
  it can run for many minutes and still only tell you *that* something leaked. Run it per
  test file in parallel instead -- it finishes in a couple of minutes and attributes each
  leak to an exact file and line:
  ```bash
  jest --listTests | xargs -P 6 -I{} \
    timeout -k 5 90 node node_modules/jest/bin/jest.js --detectOpenHandles --runTestsByPath {}
  ```
  Treat both a nonzero-124 timeout (the probe itself hung) and an "open handles" report as
  hits. Invoke the JS entrypoint, **not** `node node_modules/.bin/jest` -- `.bin/jest` is a
  shell wrapper, so `node` dies on it with `SyntaxError: missing ) after argument list`
  before running anything, and every probe "passes" with no leaks found.
- Not every hit is a production bug. The same sweep will surface tests that leak by
  *omission* -- e.g. a WebSocket test that opens a connection and never closes it, leaving
  the server's connection-scoped auth timeout pending even though production clears it
  correctly on `auth` / `close` / `error`. Fix those in the test (close what you open in an
  `afterEach`); only change production code when production is genuinely wrong.
- This is the sequel to [leaked-exit-timer-masks-test-hang.md](leaked-exit-timer-masks-test-hang.md),
  which ends by warning that a second open-handle hang is hiding behind the `process.exit()`
  timer. This is that hang. If you just fixed a leaked exit timer and CI started hanging
  instead of failing, start here.
