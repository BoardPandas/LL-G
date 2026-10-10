---
tech: go
tags: [testing, regression, counterfactual, policy-drift, native-acceptance]
severity: medium
---
# Keep historical test policies independent of current implementations

## PROBLEM

A feasibility test needs to prove that an old policy would have triggered while
the new policy correctly refuses. It instantiates the production controller
under a variable named `legacy`. Later, production gains the proposed safeguards,
so the supposed historical comparator silently acquires them too.

In a native static-video experiment, real output was about 202 kbps. That
exceeded the historical 4,000 and 7,385.6 bps budgets but remained below the
current 240,000 bps qualification floor. The test incorrectly failed because
the current controller, used as the historical comparator, did not request a
rebuild. Earlier higher-output runs happened to pass the same broken comparison.

The old test also injected active motion into that comparator and logged
constant zero proposed requests. Neither establishes the current controller's
behavior on the captured static frames.

## WRONG

```go
var legacy boundedRebuildController // This is today's implementation.
legacy.observeOutputBudget(rawEstimate, at)
legacy.observeFrameActivity(alwaysActive, at)
legacy.observeEncodedSample(actualBytes, at, true, true)
request, ok := legacy.takePending(at, alwaysActive)
// Requiring ok can now demand behavior the new safeguards correctly reject.
t.Log("proposed_requests=0") // Not a measured outcome.
```

## RIGHT

```go
// Test-only reference for the historical two-window, raw-budget-only rule.
// It must not inherit the current controller's clamp or activity gate.
legacy.observe(actualBytes, at, rawEstimate)

current.observeOutputBudget(rawEstimate, at)
current.observeFrameActivity(capturedActivity, at)
current.observeEncodedSample(actualBytes, at, true, true)
_, consumed := current.takePending(at, capturedActivity)

requireTwoHistoricalOverageWindows(legacy)
requireNoCurrentRequestsOrConsumptions(current.evidenceSnapshot(), consumed)
```

Keep the reference narrow and explicitly historical, rather than duplicating
an entire production subsystem. Test exact threshold equality, incomplete and
nonconsecutive windows, invalid evidence, and output both below and above the
new qualification floor. Above-floor active output is a positive control;
above-floor static output proves the activity guard is actually exercised.

## NOTES

- A failing-first portable regression reproduced the comparator mismatch.
  The correction changes test evidence, not production video policy.
- Do not lower thresholds, shorten measurements, add synthetic source motion,
  or discard failed recordings to make the native run pass.
- A corrected harness and green unit tests do not establish native, decoded
  image-quality, or live product acceptance. Those gates require fresh runs.
- SupportForge implementation and regression:
  [7468464](https://github.com/BoardPandas/supportforge-platform/commit/74684648a74c2a26389d3cc3f4ac576ad8da23a9).
