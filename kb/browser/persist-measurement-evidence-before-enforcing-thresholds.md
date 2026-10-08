---
tech: browser
tags: [browser-testing, performance, artifacts, assertions, ci]
severity: medium
---
# Persist measurement evidence before enforcing thresholds

## PROBLEM
A performance harness can collect every raw sample and then assert the threshold before writing the
samples to disk. When the assertion fails, the run reports only a generic limit violation and exits
without the exact gesture, duration, trace, or environment needed to diagnose it. An `always()` CI
upload cannot recover evidence that the harness never persisted.

## WRONG
```js
const summary = summarize(samples);
assertThresholds(summary);
await writeFile(rawPath, JSON.stringify({ samples, summary }));
```

## RIGHT
```js
let evidence = { samples, summary: summarize(samples), trace: null };
await writeFile(rawPath, JSON.stringify(evidence));
try {
  assertThresholds(evidence.summary);
  evidence.trace = await collectTrace();
  await writeFile(rawPath, JSON.stringify(evidence));
} catch (error) {
  evidence = { ...evidence, failure: serializeError(error) };
  await writeFile(rawPath, JSON.stringify(evidence));
  throw error;
} finally {
  await saveTraceAndRecording();
}
```

## NOTES
Keep the CI artifact upload under `if: always()` and fail when the evidence directory is missing.
Persisting evidence must not relax, retry, or make the threshold advisory.
