---
tech: rust
tags: [clippy, unwrap_used, expect_used, allow-unwrap-in-tests, integration-tests, clippy-toml]
severity: low
---
# clippy.toml allow-unwrap-in-tests does not cover helper functions in tests/*.rs

## PROBLEM
With `clippy::unwrap_used` and `clippy::expect_used` denied for the workspace, `allow-unwrap-in-tests = true` and `allow-expect-in-tests = true` in `clippy.toml` exempt `#[test]` functions and `#[cfg(test)]` modules. They do not exempt plain helper functions in an integration-test file under `tests/`, because those are not marked as test code. `cargo clippy --all-targets -D warnings` fails on `.unwrap()` inside a fixture builder even though the same call inside the test passes.

## WRONG
```rust
// tests/queue.rs
fn make_message() -> Message {
    build().unwrap()          // clippy::unwrap_used: not inside a #[test] fn
}
#[test]
fn works() { let _ = build().unwrap(); }   // fine
```

## RIGHT
```rust
// tests/queue.rs, top of file
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    reason = "integration tests: helpers outside #[test] fns fail loudly too"
)]
```

## NOTES
- Scope the allow to the integration-test file, not the crate, so product code stays denied.
- `cargo check` does not build test targets; run `cargo clippy --all-targets` to see these (see `cargo-check-skips-test-targets.md`).
