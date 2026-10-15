---
tech: github-actions
tags: [ci, timing, flaky, concurrency, runners, timeouts]
severity: medium
---
# A timing assertion over many processes started at once passes locally and fails on a 2-core runner

## PROBLEM
A test spawned 22 hook processes at once to check that each finishes within 2.5 s while curl waits out its own 2 s `--max-time`. Locally (32 cores) the slowest took about 2.1 s. On a GitHub-hosted 2-core runner one took 2,590 ms and main went red, so the deploy was skipped. Each process's startup work (bash, git, find, jq) queued for CPU *before* the timed network wait began, so contention added straight onto the 2 s floor. The test was measuring the test's own concurrency, not the code. Pinning to 2 local cores with `taskset` did not reproduce it either, because the runner's cores are slower.

## WRONG
```js
// All at once, and setup() runs synchronous git calls between spawns.
const results = await Promise.all(CASES.map((c) => { const env = setup(); return run(c, env); }));
for (const r of results) assert.ok(r.ms < 2500);
```

## RIGHT
```js
// Set everything up first, then run a small fixed number at a time: real use runs one at a time.
const runs = CASES.map((c) => { const env = setup(); return () => run(c, env); });
const results = []; let next = 0;
const lane = async () => { while (next < runs.length) { const i = next++; results[i] = await runs[i](); } };
await Promise.all([lane(), lane()]);
```

## NOTES
To check the margin, log the slowest time under `taskset -c 0` (one CPU). Here the old version reached 2,427 ms and the new one 2,094 ms. Synchronous `execFileSync` in setup also blocks the event loop that observes the other children's `close`, which inflates their measured times. Keep the limit itself: change how the check runs, not what it allows. Found in Roundtable C6 (2026-10-15).
