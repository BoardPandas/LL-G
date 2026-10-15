---
tech: jest
tags: [jest, coverage, v8, swc, memory, oom, github-actions, workerIdleMemoryLimit]
severity: medium
---
# coverageProvider: 'v8' OOMs the coordinator heap and churns workers on large suites

## PROBLEM

In a large Jest suite (hundreds of test files transformed by `@swc/jest` with `collectCoverageFrom: ['src/**/*.ts']` and `workerIdleMemoryLimit: '512MB'`), switching from Jest's default Babel coverage instrumentation to `coverageProvider: 'v8'` looks faster on a multi-core developer workstation with a 4 GB+ V8 heap, but fails on 2-vCPU GitHub Actions runners (`ubuntu-latest`) with `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory` (exit code 134) after running 3x to 4x slower (12m 17s vs 3m 50s).

Two mechanisms combine to cause this:

1. **Coordinator heap accumulation**: Under `coverageProvider: 'v8'`, each test file worker runs `Profiler.takePreciseCoverage()` and sends raw V8 `ScriptCoverage` range arrays over IPC back to the parent Jest coordinator process. The coordinator holds all suites' raw V8 profiles in memory until the end of the run and then compiles untested `collectCoverageFrom` files and runs `v8-to-istanbul` + source-map conversion in the parent process, exceeding Node's ~2 GB default old-space heap limit on 7 GB CI runners.
2. **Worker memory churn**: Enabling detailed V8 bytecode range profiling (`callCount: true, detailed: true`) across isolated module registries (`createApp()`, heavy route suites) inflates per-worker RSS past `workerIdleMemoryLimit: '512MB'` far more frequently, forcing Jest to kill and cold-spawn workers repeatedly on 2 vCPUs.

By contrast, Jest's default `coverageProvider: 'babel'` caches the Istanbul-instrumented transform on disk once per source file and returns compact integer hit-count maps per test file that merge in constant coordinator memory.

## WRONG

```js
// jest.config.js
module.exports = {
  workerIdleMemoryLimit: '512MB',
  coverageProvider: 'v8',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
  transform: {
    '^.+\\.ts$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
  },
};
```

## RIGHT

```js
// jest.config.js
module.exports = {
  workerIdleMemoryLimit: '512MB',
  // Keep default coverageProvider ('babel'): Istanbul-instrumented files are
  // cached on disk and merge compact integer hit counts per suite without
  // accumulating raw V8 range profiles in the coordinator process.
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
  transform: {
    '^.+\\.ts$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' } } }],
  },
};
```

## NOTES

- Measured on SupportForge Platform (`702` unit suites in API, `214` suites in Next.js dashboard):
  - With `coverageProvider: 'v8'` on `ubuntu-latest`: API ran for `12m 17s` before crashing with `Mark-Compact 2061.5 (2106.3) -> 2058.9 (2133.5) MB ... Reached heap limit Allocation failed`; Dashboard took `11m 32s`.
  - With default `coverageProvider: 'babel'` on `ubuntu-latest`: API passed in `3m 50s` to `5m 53s` and Dashboard passed in `2m 55s` to `5m 30s` with flat coordinator memory.
