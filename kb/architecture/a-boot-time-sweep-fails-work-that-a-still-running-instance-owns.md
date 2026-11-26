---
tech: architecture
tags: [architecture, deploy, rolling-deploy, overlap, shutdown, startup-sweep, background-jobs, railway, shared-store]
severity: high
---
# A boot-time sweep that fails "interrupted" work is wrong when a deploy overlaps instances

## PROBLEM
A service that runs background jobs and records their state in a shared store often sweeps at startup: "anything still marked running was interrupted by the restart, so mark it failed". That assumes the previous instance is already gone. On a platform that starts the new instance before it stops the old one (rolling or zero-downtime deploys, including Railway's default overlap), both instances share the store for a while, and the new one cannot see the old one's memory. The sweep fails jobs the old instance is still running. The user is told to run the work again although its writes had already landed, which can duplicate side effects.

## WRONG
```ts
// on boot
await db.query(`UPDATE jobs SET status='failed', message='Restarted, run again' WHERE status='working'`);
```

## RIGHT
```ts
// 1. The stopping instance closes its own jobs in its shutdown step, bounded in time.
process.on("SIGTERM", async () => {
  abortRunningJobs();
  await withTimeout(markOwnJobsFailed(runningIds), 2_000);   // message says "some steps may already have run"
});

// 2. The new instance sweeps once, later than the platform's overlap + draining time plus margin,
//    and never touches a job it is running itself.
const SWEEP_DELAY_MS = 90_000;                                // overlap 20 s + draining 15 s, with margin
setTimeout(() => failOrphans({ exceptIds: runningIds() }), SWEEP_DELAY_MS).unref();
```

## NOTES
- Derive the delay from the platform's actual teardown settings and write them next to the constant; revisit it if they change.
- Tell the user the truth in the failure message: "Some steps may already have finished. Check before running it again."
- Do not promote new jobs once shutdown has begun.
- A cancel should be written to the store before running work is aborted, so a failed write cannot leave a row marked running with nothing running it.
- Related: with a single instance and no overlap, a boot sweep is correct; the bug appears only when two generations coexist.
