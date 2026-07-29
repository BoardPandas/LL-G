---
tech: lumen
tags: [naas, internet-on-demand, qualify, price, 422, not-a-naas-enabled-location, transient, retry, outage, error-classification]
severity: high
---
# "Not a NaaS Enabled Location" is also a transient provider-wide fault, not only a de-listed location

## PROBLEM
`GET /Product/v1/price` returns `422 {"reason":"Not a NaaS Enabled Location",
"code":"INVALIDVALUE","propertyPath":"masterSiteId"}` for **two unrelated
causes**, and the response is byte-identical in both:

1. **Terminal** — the location genuinely is not enabled for on-demand ordering,
   or you qualified a customer-port circuit without `serviceId` (see
   [qualify-serviceid-customer-port.md](qualify-serviceid-customer-port.md)).
2. **Transient** — Lumen is faulting on their side and returns it for
   *everything*, including locations they quoted minutes earlier and quote again
   minutes later.

The sibling entry documents only cause 1, which makes the natural reading "this
is a fact about the location" — so the obvious handling is to fail the operation
and surface the reason. That is wrong, and wrong in a way that reaches the
customer: on an automated bandwidth-change path it turns a vendor blip into a
terminal failure whose stated reason blames a building that is fine, and it
trips any repeat-failure circuit breaker downstream, suspending automation that
then needs a manual resume long after the vendor recovered.

Observed 2026-07-29 in Vigilis production. Qualify calls by hour (UTC), against
a steady baseline of 3 known-bad rows:

| Hour  | 200 | 422 |
|-------|-----|-----|
| 06:00 | 16  | 3   |
| 08:00 | 12  | 5   |
| 10:00 | 0   | 14  |
| 12:00 | 2   | 0   |
| 16:00 | 15  | 3   |

In the 10:00 hour **every** qualify failed — 14 calls across 13 distinct
`masterSiteId`s and two unrelated customers. The same sites returned 200 at
06:00, 08:00, 12:00 and 16:00 on identical credentials, with `serviceId` sent
correctly throughout. Nothing in the payload distinguishes the hours.

There is no Lumen status page entry for it, so the only signal you get is your
own error rate.

## WRONG
```ts
// Reads the 422 as a property of the location and fails immediately.
// A 20-minute vendor blip becomes a permanent FAILED row plus a customer email
// saying their site is not NaaS-enabled.
try {
  await qualifyService({ masterSiteId, serviceId, customerNumber, credentials });
} catch (err) {
  await markFailed(changeId, describeProviderError(err.message));
  await alertCustomer(changeId);   // "Reason: Not a NaaS Enabled Location"
  throw err;
}
```

## RIGHT
```ts
// Treat it as retryable-then-terminal. Bounded retries cost minutes; believing
// it on sight costs a false customer-facing failure and a tripped breaker.
export function isProviderQualifyTransientError(raw: string): boolean {
  return /not a naas enabled location/i.test(raw);
}

const attempt = job.data.providerConflictAttempt ?? 0;
if (isProviderQualifyTransientError(raw) && attempt < MAX_RETRIES) {
  await resetToPending(changeId);
  await queue.add(jobName, { ...job.data, providerConflictAttempt: attempt + 1 },
                  { delay: RETRY_MS, jobId: `${changeId}-retry-${attempt + 1}` });
  return;
}
// Exhausted: still fail, but say what was actually established.
await markFailed(changeId,
  `Lumen would not quote this circuit after ${MAX_RETRIES} attempts over ~${windowMin} minutes, ` +
  `reporting "Not a NaaS Enabled Location". This is usually a temporary fault on Lumen's side; ` +
  `if it persists, the location may need to be re-enabled for on-demand ordering. ` +
  `The circuit was left at its current speed.`);
```

## NOTES
- Share one retry budget with any existing provider back-pressure retry (e.g.
  `"The Service Id cannot be modified since the current status is - Change
  pending"`) rather than giving each error class its own allowance — otherwise a
  single request can ping-pong between classes and retry indefinitely.
- Match on the **message text**, not `code`. `INVALIDVALUE` is Lumen's generic
  bad-input code and covers genuine config errors that must fail on the first
  attempt; only the "not a NaaS enabled location" string identifies this case.
- **Do not let a de-linked circuit manufacture a false baseline.** A soft-deleted
  or de-linked circuit reliably answers this 422, so any pricing-refresh sweep
  that includes deleted rows emits a constant trickle of it. Three such rows made
  the real provider-wide outage above look like business as usual for hours.
  Filter deleted rows out of the sweep so the error rate means something.
- The bounded retry does **not** ride out a multi-hour vendor event, and is not
  meant to — it converts the common short blip into a non-event and makes the
  rare long one fail with an honest message instead of a misleading one.
- Fixed in Vigilis 2.176.8: `isProviderQualifyTransientError`
  (src/lib/network/change-outcome.ts), wired in worker/bandwidth-change.ts;
  deleted-row filter in src/lib/network/refresh-pricing.ts.
