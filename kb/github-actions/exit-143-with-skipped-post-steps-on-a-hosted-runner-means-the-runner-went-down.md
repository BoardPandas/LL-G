---
tech: github-actions
tags: [jest, shard, maxWorkers, exit-143, oom, hosted-runner]
severity: high
---
# Exit 143 with skipped post steps on a hosted runner means the runner went down, not a failing test

## PROBLEM
A GitHub-hosted job that ends "Process completed with exit code 143" with its post steps (checkout, setup cleanup) marked skipped means the runner itself was taken down, most likely out of memory, not that a test failed.
It looks like a flaky test: no failing assertion, no heap out-of-memory message, nothing in the log but silence before the kill. Sometimes the runner never reports back at all and the job sits until `timeout-minutes`. Re-running "fixes" it, so the real cause is easy to miss. It started for us the moment a Jest suite was split with `--shard` and given two workers on the 2-vCPU runner: two suites that each build the whole Express app ran side by side and exhausted the machine. The same suite had passed 123 times in a row with one worker.

## WRONG
```yaml
test-api:
  runs-on: ubuntu-latest   # 2 vCPU on private repos
  strategy:
    matrix:
      shard: [1, 2, 3]
  steps:
    - run: pnpm exec jest --coverage --shard=${{ matrix.shard }}/3 --maxWorkers=2
```

## RIGHT
```yaml
test-api:
  runs-on: ubuntu-latest
  strategy:
    matrix:
      shard: [1, 2, 3, 4]   # one more shard buys back the second worker's speed
  steps:
    - run: pnpm exec jest --coverage --shard=${{ matrix.shard }}/${{ strategy.job-total }} --maxWorkers=1
```

## NOTES
- Diagnose by comparing which files printed PASS/FAIL against a successful run of the same shard on a nearby commit: `--shard` assigns files deterministically, so the files that never reported were in flight at the kill. Ours died at the same suite both times.
- `workerIdleMemoryLimit` does not help here: it recycles a worker between files, not during one.
- If a shard still dies with exit 143 at one worker, use a larger runner.
- Remember to raise the coverage merge's expected shard count with the matrix.
- Related: github-actions/concurrent-timing-tests-fail-on-small-ci-runners, jest/v8-coverage-coordinator-heap-oom.
