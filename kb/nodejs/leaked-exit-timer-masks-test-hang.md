---
tech: nodejs
tags: [testing, jest, timers, process-exit, ci, open-handles, teardown]
severity: high
---
# A leaked timer calling process.exit() disguises a test-suite hang as a fast failure

## PROBLEM

Shutdown code commonly arms a watchdog: `setTimeout(() => process.exit(1), N)`,
cleared once graceful shutdown finishes. Tests exercise that path with a mocked
server whose `close()` is a bare `jest.fn()` -- it never invokes its callback, so
the `clearTimeout` living inside that callback never runs. Each such test leaves
a live timer behind, and any test that spied on `process.exit` typically restores
the real one on its way out.

That alone is a latent bug. It becomes genuinely misleading when the suite *also*
has an unrelated open handle keeping the process alive after the run. Now two
faults are stacked, and they hide each other:

- The orphaned timer fires into the hang and calls the real `process.exit(1)`.
- The run reports `Tests: 1514 passed` and then exits **1**, seconds later.

It reads as a flaky test. It is not: every test passed, and the exit code comes
from application code running after the suite finished. Worse, it is
timing-dependent -- whether the timer outlives the process decides it -- so a
fast dev machine force-exits the worker and returns 0, while a slower CI runner
fails. That asymmetry ("passes locally, fails in CI") invites you to blame the CI
environment.

The sting is in the order of repair. Fix the timer and the false failure
disappears, revealing the hang underneath -- which now has nothing left to kill
it, so the job runs until it hits the runner's timeout (6 hours by default on
GitHub Actions). The correct fix looks like a regression.

## WRONG

```ts
// The test: close() never calls its callback, so the 15s timer is never cleared.
it('should call server.close when shutdown is triggered', () => {
  const mockServer = { close: jest.fn() };
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  gracefulShutdown(mockServer, mockCleanup);
  process.emit('SIGTERM');            // arms setTimeout(... process.exit(1), 15000)

  expect(mockServer.close).toHaveBeenCalled();
  exitSpy.mockRestore();              // real process.exit restored; timer still pending
});
```

```ts
// The tempting "fix" in production code. Do not do this to satisfy a test.
const forceShutdownTimer = setTimeout(() => process.exit(1), 15000);
forceShutdownTimer.unref();
// An unref'd timer no longer holds the loop open, so a hung cleanup with no
// pending I/O now exits 0 instead of the intended forced 1. That is a change to
// shutdown semantics, made to paper over a defect in a mock.
```

## RIGHT

```ts
// Fix it in the test, where the defect is: no real timer is ever created.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();   // discards pending fake timers; nothing outlives the test
});
```

```yaml
# And cap the job, so the next hang costs minutes rather than a runner.
jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15
```

## NOTES

Diagnosis order matters. "All tests passed, then exit 1" is not a failing test --
read the log *after* the summary line. `Jest did not exit one second after the
test run has completed` immediately before the exit is the signature of this
pair; a stack trace pointing into application code (not a test file) confirms the
exit came from a leaked timer.

Locally the same leak usually shows up only as `A worker process has failed to
exit gracefully and has been force exited`, with exit 0. Treat that warning as a
real defect rather than noise -- it is the quiet form of a bug that will fail or
hang on a slower machine.

Expect to need two fixes, and expect the first to look like it made things worse.
`jest --forceExit` is a legitimate stopgap for the open handle once the timer is
fixed: all tests still run and report, and it only takes effect after results are
in. Track removing it, because it also suppresses the warning that would tell you
about the next leak.

Beware the inverse trap: something that *reliably* terminates a hung run can be
the only reason the hang has never been noticed.

Related: [[bullmq-redis-delayed-jobs-lost]] -- another case where the absence of
an error, rather than an error, is the symptom.
