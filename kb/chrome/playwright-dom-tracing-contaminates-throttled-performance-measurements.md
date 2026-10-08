---
tech: chrome
tags: [chrome, chromium, playwright, performance, tracing, throttling, observer-effect, long-tasks]
severity: high
---
# Playwright DOM tracing contaminates throttled performance measurements

## PROBLEM
Playwright tracing with DOM snapshots or screenshots enabled runs capture work inside Chromium. On a large page under CPU throttling, that observer work can create the same long tasks and input-to-paint delay the test is grading. The product path may be fast, yet the acceptance run fails only because the measurement harness repeatedly serializes the DOM or captures trace frames. This is hard to recognize because the trace is normally treated as passive evidence, and the resulting latency and long-task records look like genuine application regressions.

Compare the same fixed workload, browser, CPU allocation, throttle, warm-up count and sample count with and without the observer-heavy trace channels before changing product code or relaxing thresholds.

## WRONG
```javascript
await context.tracing.start({
  screenshots: true,
  snapshots: true,
  sources: true,
});

const samples = await runThrottledInputToPaintSamples();
assertPerformanceThresholds(samples);
```

## RIGHT
```javascript
await context.tracing.start({
  screenshots: false,
  snapshots: false,
  sources: true,
});

const samples = await runThrottledInputToPaintSamples();
await writeRawEvidence(samples);
assertPerformanceThresholds(samples);
await context.tracing.stop({ path: apiSourceTracePath });
```

Retain visual and renderer evidence through video plus a separate Chrome DevTools Protocol performance trace. Write raw measurements before enforcing thresholds so a failing run remains diagnosable.

## NOTES
Do not compensate by adding warm-ups, lowering fixture size, reducing CPU throttling, or raising budgets. Those changes alter the acceptance contract and can hide a real regression. Add a repository guard when a specific workflow must keep screenshots and DOM snapshots disabled inside its timed sample.

