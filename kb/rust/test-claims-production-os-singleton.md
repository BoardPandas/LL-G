---
tech: rust
tags: [testing, test-isolation, named-mutex, single-instance, windows, flaky-tests, ci]
severity: medium
---
# A test that calls the production single-instance guard claims the REAL app's OS singleton, so it fails only where the app is installed and running

## PROBLEM

A single-instance guard works by claiming a machine-global named OS object -- a
`Local\`-scoped named mutex on Windows, a well-known lockfile, a fixed TCP port,
an abstract socket. The name is a hardcoded constant, and it must be, because
that constant is the whole mechanism: the second process finds the name taken.

A unit test that calls the production entry point therefore does not test the
guard against itself. It contends with **the installed application**. So the
test asserts "the lock is free", which is true on a clean box and false on the
machine of anyone actually running the app -- i.e. every developer dogfooding
it. The suite goes red for a reason that has nothing to do with the change
under test, and the natural response is to stop trusting the suite.

Three things keep this from being noticed:

- **CI is green, permanently.** A CI runner never has the app installed or
  running, so the failure cannot reproduce where anyone looks for it. Green CI
  reads as "the test is isolated" when it only means "the box is clean".
- **It presents as environment-dependent flakiness**, not a test defect: the
  same commit passes on the build server and fails locally, which sends people
  hunting for a machine difference rather than reading the test.
- **The other platform's arm of the same module is often already correct.**
  A Unix implementation usually takes a path (`acquire_at(&Path)`) because a
  tempdir is the obvious way to write the test at all, so the file *looks* like
  it has the right shape. The Windows arm has no natural parameter to reach
  for, so it calls the constant directly and the asymmetry survives review.

The inverse spelling is worse and silent: a test asserting the *contended*
branch (`assert!(acquire().is_none())`) passes on a developer machine for
entirely the wrong reason -- the installed app is holding the lock, not the
code under test -- and reports green while exercising nothing.

## WRONG

```rust
const MUTEX_NAME: &str = r"Local\MyApp-SingleInstance-9F2A7C41-...";

pub(super) fn acquire() -> Result<Option<Guard>, Error> {
    let handle = unsafe { CreateMutexW(None, false, &HSTRING::from(MUTEX_NAME)) }
        .map_err(Error::Mutex)?;
    let already_running = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    let guard = Guard(handle);
    if already_running { return Ok(None); }
    Ok(Some(guard))
}

#[test]
fn second_acquire_sees_the_first() {
    // Contends with the INSTALLED app, not with the next line.
    // Panics with "lock is free" on any machine where MyApp is running;
    // passes in CI only because no MyApp process exists there.
    let first = acquire().expect("first acquire").expect("lock is free");
    assert!(acquire().expect("second acquire").is_none());
    drop(first);
    assert!(acquire().expect("third acquire").is_some());
}
```

## RIGHT

```rust
const MUTEX_NAME: &str = r"Local\MyApp-SingleInstance-9F2A7C41-...";

pub(super) fn acquire() -> Result<Option<Guard>, Error> {
    acquire_named(MUTEX_NAME)
}

/// The name is a parameter purely so tests can claim one of their own.
fn acquire_named(name: &str) -> Result<Option<Guard>, Error> {
    let handle = unsafe { CreateMutexW(None, false, &HSTRING::from(name)) }
        .map_err(Error::Mutex)?;
    let already_running = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    let guard = Guard(handle);
    if already_running { return Ok(None); }
    Ok(Some(guard))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// The pid rules out an installed app and any concurrently running copy of
    /// this test binary; the counter rules out two tests in this one. A fixed
    /// literal like "...-test" would only move the collision.
    fn unique_name() -> String {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        format!(
            r"Local\MyApp-SingleInstance-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )
    }

    #[test]
    fn second_acquire_sees_the_first() {
        let name = unique_name();
        let first = acquire_named(&name).expect("first").expect("lock is free");
        assert!(acquire_named(&name).expect("second").is_none());
        drop(first);
        assert!(acquire_named(&name).expect("third").is_some());
    }
}
```

The public API does not change: `acquire()` still takes no argument and still
uses the permanent constant. Only the seam moves inward.

## NOTES

- **Generalises past named mutexes.** Any machine-global name a test can
  collide with: a named event/semaphore, a fixed TCP/UDP port, a Unix-domain or
  Linux abstract socket, a `/var/run` or per-user-data-dir lockfile, a D-Bus
  well-known name, a shared-memory segment. Same fix: the production entry
  point keeps the constant, an internal arm takes the name/path/port, tests
  pass something unique per run.
- **Make it unique per run, not merely different.** A hardcoded `"...-test"`
  constant still collides between two concurrent `cargo test` invocations and,
  worse, between a test binary and any leftover process from a previous run.
  Pid plus an atomic counter costs nothing and closes both.
- **Verify against the failing condition, not just the clean one.** "The test
  passes" on a clean box is what the bug already produced. Confirm the app is
  actually running (or hold the production name from a second process) and run
  it again; then run two test binaries concurrently to prove the names are
  independent.
- Related, same root cause -- CI's clean environment hiding a test that is not
  self-contained: [cargo check skips test targets](cargo-check-skips-test-targets.md).
- **Watch for the vacuous-pass sibling in existing suites.** A test asserting
  the "already running" branch and nothing else is untrustworthy by
  construction; it is green on a developer machine whether or not the guard
  works. If a single-instance test has never failed on anyone's machine,
  check which branch it asserts.
