---
tech: nodejs
tags: [bullmq, redis, railway, delayed-jobs, scheduling, persistence, silent-failure]
severity: high
---
# BullMQ Delayed Jobs Are Silently Lost When Redis Is Redeployed

## PROBLEM
Redeploying or upgrading the Redis service backing BullMQ flushes the BullMQ keyspace, even when the operation looks like a safe "same-volume tag bump" (e.g. Railway Redis 7 -> 8 on the same `/data` volume). The result is split:

- **Repeatable jobs survive** because the worker re-registers them on boot (`queue.add(..., { repeat })` runs again at startup), so recurring ticks self-heal and hide the problem.
- **One-off DELAYED jobs are permanently lost.** Scheduled tasks, finalize/settle jobs, and any `queue.add(..., { delay })` job that was sitting in the delayed set is gone with no replacement.

The truly dangerous part is that nothing alerts. A job that never runs throws no exception, so any monitoring built only on `try/catch` or `failed` events sees nothing. DB rows that reference those jobs (e.g. `status = PENDING` with a stored `jobId`) stay PENDING forever and never fire. In the Flux incident, 8 customer bandwidth schedules sat PENDING for 5 days after a Redis swap and no error was ever logged.

Tell-tale sign that this happened: the BullMQ job-id counter has reset to low numbers. New jobs get ids like ~83 while the orphaned rows reference ids in the 800s (869-883). A counter that went backwards means the keyspace was wiped.

## WRONG
```ts
// Enqueue a one-off delayed job, store its id, and assume it will fire.
const job = await queue.add('finalize', { changeId }, { delay: TEN_MIN })
await db.scheduledChange.update({
  where: { id: changeId },
  data: { status: 'PENDING', jobId: job.id },
})

// Monitoring only catches jobs that RAN and threw.
worker.on('failed', (job, err) => alert(`job ${job.id} failed: ${err}`))
// A job that was wiped from Redis never runs, never fails, never alerts.
// The PENDING row is orphaned forever.
```

## RIGHT
```ts
// 1. Treat the DB as the source of truth, Redis/BullMQ as a cache of pending work.
//    Add a watchdog that detects ABSENCE (overdue + still PENDING), not just exceptions.
//    Run it on a repeatable schedule so it survives a Redis flush itself.
queue.add('schedule-watchdog', {}, { repeat: { every: 15 * 60 * 1000 } })

worker.process('schedule-watchdog', async () => {
  const overdue = await db.scheduledChange.findMany({
    where: { status: 'PENDING', runAt: { lt: new Date() } },
  })
  if (overdue.length) {
    await sendAlert(`${overdue.length} overdue PENDING schedules never fired`)
  }
})

// 2. After ANY Redis redeploy/upgrade, scan for orphaned delayed jobs and rebuild them.
//    A recovery script that cancels stale rows and re-enqueues the next forward
//    occurrence: cancel where runAt < now, then queue.add(..., { delay }) afresh.
//    Verify success by checking the rebuilt rows have a non-null jobId.

// 3. Don't trust "same-volume tag bump" to preserve the keyspace. Verify AOF/RDB
//    persistence is actually enabled AND loaded after the swap, or assume loss
//    and run the recovery scan every time.
```

## NOTES
- Repeatable vs one-off is the key distinction: workers re-register repeatable jobs on boot, so only one-off DELAYED jobs are silently lost. Audit every `queue.add` that passes a `delay` (and no `repeat`) for orphan risk.
- The watchdog must alert on overdue/never-ran, not on thrown errors. Exception-based monitoring cannot see a job that simply does not exist.
- Redis `appendonly yes` (AOF) or RDB snapshots are not guaranteed to be read back after a major image swap on some managed platforms (Railway among them); confirm the keyspace size after the redeploy rather than trusting the config.
- Related cross-store source-of-truth drift lives under the Architecture index.
