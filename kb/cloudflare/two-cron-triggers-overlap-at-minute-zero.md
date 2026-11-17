---
tech: cloudflare
tags: [cron-triggers, scheduled, idempotency, duplicate, workers]
severity: medium
---
# Two cron triggers that both match minute 0 run the scheduled handler twice

## PROBLEM
Adding `*/10 * * * *` beside an existing `0 * * * *` gives two separate invocations at the top of every hour. If the handler runs a shared job on both (say, "send pending notification emails"), the job runs twice concurrently. With an idempotency key on the outbound call the second request gets a 409 while the first is in flight; code that treats any non-2xx as failure then marks the run failed, retries, or withholds a heartbeat, once an hour, for no real fault. Without a key, the mail is sent twice.

## WRONG
```ts
async scheduled(controller, env) {
  if (controller.cron === "*/10 * * * *") await sendDigests(env);
  else { await sendDigests(env); await hourlyCleanup(env); } // digests run twice at :00
}
```

## RIGHT
```ts
async scheduled(controller, env) {
  // Each job belongs to exactly one trigger. */10 already fires at :00.
  if (controller.cron === "*/10 * * * *") await sendDigests(env);
  else await hourlyCleanup(env);
}
// And in the sender: 409 on an idempotent replay means "already sent", not "failed".
```

## NOTES
- Test each trigger by passing its exact cron string and asserting which jobs ran.
