---
tech: go
tags: [time-ticker, capture-cadence, monotonic-time, performance, regression-tests]
severity: high
---
# Do not add a base tick after a capture interval has elapsed

## PROBLEM

A capture controller can count delivered base ticks to select a lower frame
rate while using elapsed time as a fallback for slow synchronous work.
Go's ticker may drop deliveries when its consumer is slow. Those missed
deliveries are not extra time that the controller should wait afterward.

Adding a base tick to an already selected elapsed interval silently lowers
capture cadence under load. Each capture can finish inside the intended
interval, transport writes can be fast, and the total average can look plausible,
yet fixed five-second acceptance windows miss their minimum sample count.

## WRONG

```go
// Called once per delivered base tick, under the controller's existing lock.
ticksSinceCapture++
if lastCaptureAt.IsZero() ||
    ticksSinceCapture >= selectedTicks ||
    now.Sub(lastCaptureAt) >= selectedInterval+baseInterval {
    lastCaptureAt = now
    ticksSinceCapture = 0
    return true
}
return false
```

When selectedInterval is five base ticks at a 30 Hz base rate, a dropped-delivery
fallback can wait about 200 ms instead of the intended 166.67 ms.

## RIGHT

```go
// now is fresh time.Now() at the decision, not a stale queued ticker timestamp.
// Keep the same selectedTicks/selectedInterval and the existing lock.
ticksSinceCapture++
if lastCaptureAt.IsZero() ||
    ticksSinceCapture >= selectedTicks ||
    now.Sub(lastCaptureAt) >= selectedInterval {
    lastCaptureAt = now // Do not repay missed intervals with a catch-up burst.
    ticksSinceCapture = 0
    return true
}
return false
```

Use monotonic elapsed time for the selected interval. Preserve the existing
policy tiers, queue bounds, and congestion authority. This correction is for
an unintended extra wait, not permission to increase a configured frame-rate
floor or weaken a bandwidth cap.

Test the actual controller with missing deliveries, exact interval boundaries,
ordinary jitter, long stalls, and tier transitions. Evaluate every fixed bucket
and adjacent pair rather than accepting an aggregate average.

## NOTES

- [Go NewTicker documentation](https://pkg.go.dev/time#NewTicker) describes
  adjustment or dropped deliveries for slow consumers.
- In the SupportForge deterministic regression, every third capture consumed
  147 ms, within the selected six-FPS interval. Over the measured 60 seconds,
  the original controller produced a minimum 28 frames per five-second window,
  minimum adjacent pair 56, and 5.617 FPS. Removing only the extra base tick
  produced 30, 60, and 6.000 respectively. The gates remained 29, 59, and 5.9.
- [Pinned failing/passing evidence](https://github.com/BoardPandas/supportforge-platform/blob/dc75fedcbf4dcb80327b726bc70afcfe11d69c2b/tasks/evidence/2026-10-09-capture-cadence-correction/README.md)
  and [real-controller regressions](https://github.com/BoardPandas/supportforge-platform/blob/dc75fedcbf4dcb80327b726bc70afcfe11d69c2b/desktop_agent_v2/internal/remotecontrol/cadence_scheduling_test.go)
  preserve the causal test. These are deterministic scheduling results, not a
  claim that the full Windows recorded acceptance or production blur is fixed.
- Measure fresh-frame submission gaps and capture duration separately. Preserve
  gaps across reporting boundaries; reused primer frames must not hide them.
  Round duration evidence conservatively and treat zero observations as missing
  proof, not a latency pass.
- No Claude/Codex configuration guard is appropriate for this runtime timing
  defect. Production-controller regressions enforce the invariant alongside
  this reusable lesson.
