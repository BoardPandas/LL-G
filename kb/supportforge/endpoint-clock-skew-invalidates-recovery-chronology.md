---
tech: supportforge
tags: [remote-recovery, clock-skew, powershell, ninjaone, audit-evidence]
severity: high
---
# Endpoint clock skew invalidates cross-machine recovery chronology

## PROBLEM

A Windows endpoint can successfully run commands while its clock differs from the coordinator and API. A recovery harness that subtracts an endpoint-provided `CheckedAtUtc` from coordinator time can reject a newly collected baseline as being in the future. More dangerously, comparing an endpoint service-process start time directly with a coordinator restart-request timestamp can claim a process started after the request even when it did not.

Observed during an independently controlled SupportForge service-recovery check: an endpoint clock was approximately 101 seconds ahead. A freshness guard correctly stopped before submitting any restart. The successful recovery was later established with a new process, endpoint-local chronology and independent server evidence, without changing the device clock.

## WRONG

```ts
// The two timestamps come from different clocks.
const ageMs = Date.now() - Date.parse(baseline.endpointCheckedAtUtc);
assert(ageMs >= 0 && ageMs < 15 * 60_000);
assert(Date.parse(after.endpointProcessStartedAtUtc) >
       Date.parse(restart.coordinatorRequestedAtUtc));
```

## RIGHT

```ts
// Record receipt immediately when the command response is obtained.
const baselineReceipt = {
  endpoint: baseline,
  coordinatorReceivedAtUtc: new Date().toISOString(),
  receivedMonotonicMs: performance.now(),
};

// In a single process, use monotonic elapsed time for freshness.
const ageMs = performance.now() - baselineReceipt.receivedMonotonicMs;
assert(ageMs >= 0 && ageMs < 15 * 60_000);

// Compare endpoint process chronology within the same endpoint clock.
assert(after.pid !== baseline.pid);
assert(Date.parse(after.endpointProcessStartedAtUtc) >
       Date.parse(baseline.endpointCheckedAtUtc));
const localProcessAgeMs = Date.parse(after.endpointCheckedAtUtc) -
  Date.parse(after.endpointProcessStartedAtUtc);
assert(localProcessAgeMs >= 0 && localProcessAgeMs < 3 * 60_000);

// Also require independent evidence in a known server/coordinator clock domain:
// an acknowledged independent restart, successful remote reconnection/command,
// newly recorded heartbeat, and fresh token issuance with the expected identity.
assert(restart.httpStatus === 204);
assert(server.heartbeatAfterRestart);
assert(server.freshCommandProof === 'device-token');
```

## NOTES

- For evidence persisted across processes, store a coordinator-generated receipt time immediately and apply a bounded age check. Do not relabel old evidence with a new receipt timestamp to make it fresh.
- Record timestamp provenance. Coordinator, endpoint, database, application and log-ingestion timestamps are not interchangeable. Check alignment before comparing clocks; prefer causal identifiers or a server-side before/after observation when alignment is uncertain.
- A PID change alone can be misleading because IDs can be reused. Combine process start time, command output identity, server evidence and the independent-control receipt. If the endpoint clock steps during the check or ordering is ambiguous, stop and investigate.
- Capture the restart attempt before submitting it, and inspect the receipt before retrying. A preflight refusal is not a failed restart and should not cause repeated mutations.
- Clock correction is a separate operational change. Do not silently run time synchronization or weaken certificate validation to make a diagnostic pass.
