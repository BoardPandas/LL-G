---
tech: nodejs
tags: [setinterval, promises, unhandled-rejection, scheduled-jobs, database, error-handling]
severity: high
---
# A scheduled job's bookkeeping can reject outside its own error handler

## PROBLEM

A timer callback can appear protected by try/catch while still returning a
rejected promise. Two common gaps are an awaited task-start write before the
try block and an awaited task-failure write inside the catch block. Both often
use the same database as the job itself, so an exhausted connection pool makes
the bookkeeping fail at exactly the moment error containment matters most.

Node's setInterval does not consume the promise returned by an async callback.
The rejection escapes to the process-level unhandledRejection handler, which
may shut down an otherwise recoverable API. A job that correctly uses row
claims for concurrency can still be missing the error boundary supplied by a
shared exclusive-scheduler wrapper it intentionally does not use.

Observed in SupportForge production on 2026-09-29: a five-second pg-pool timeout
in recordTaskStart for rmm_webhook_dispatch triggered graceful shutdown. The
database remained running. Restarting the API restored requests, and tests
reproduced both the task-start failure and a rejection from failure recording.
The original pool contention trigger was not established by that evidence.

## WRONG

```ts
const tracked = async () => {
  const runId = await recordTaskStart(); // outside the catch boundary
  try {
    await dispatch();
    await recordTaskComplete(runId);
  } catch (error) {
    await recordTaskFailed(runId, error); // can reject too
  }
};
setInterval(tracked, 10_000); // ignores the returned promise
```

## RIGHT

```ts
setInterval(() => {
  // Catch the entire task, including bookkeeping and its own failure handler.
  void tracked().catch((error: unknown) => {
    console.error('Scheduled dispatch failed:',
      error instanceof Error ? error.message : String(error));
  });
}, 10_000);
```

The outer handler must report without depending on the failed database. Keep
the existing concurrency and claiming semantics: introducing a global lock
solely to obtain its error handler unnecessarily serializes independent workers.
The next scheduled interval supplies the retry without an immediate retry storm.

## NOTES

- Test through the real timer callback with fake timers. Reject task-start
  once, advance one interval, and assert no unhandled rejection; advance again
  and prove dispatch succeeds. Repeat with dispatch and failure recording both
  rejecting. Tests of only the dispatch body miss both gaps.
- A liveness endpoint returning 200 is not proof that the application's shared
  database pool works. Verify real database-backed requests after recovery.
- This boundary prevents a bookkeeping error from crashing the process; it
  does not itself diagnose or eliminate the database contention that exposed it.
- Regression and fix: https://github.com/BoardPandas/supportforge-platform/commit/092a86872cd23e5cb7e7463a18ae378088dc97c7
