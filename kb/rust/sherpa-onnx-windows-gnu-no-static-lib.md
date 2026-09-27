---
tech: rust
tags: [sherpa-onnx, windows-gnu, linking, cargo-test, toolchain]
severity: medium
---
# sherpa-onnx-sys has no static library for x86_64-pc-windows-gnu

## PROBLEM
On the `stable-x86_64-pc-windows-gnu` toolchain, any build that enables the native sherpa-onnx engine fails at link time: `could not find native static library 'sherpa-onnx-c-api'`. `cargo check` and `cargo clippy` never link, so they pass and the failure only appears at `cargo test` / `cargo build`. Feature unification makes it worse: a single crate that enables the engine by default (an app crate with `default = ["local-engine"]`) breaks `cargo test --workspace` for every crate.

## WRONG
```bash
cargo clippy --workspace --all-targets -- -D warnings  # green
cargo test --workspace                                  # link error, all crates
```

## RIGHT
```bash
# Test everything that does not pull the native engine...
cargo test --workspace --exclude hark-app
# ...then the app crate without the engine feature.
cargo test -p hark-app --no-default-features
# Full coverage: an MSVC toolchain, or CI on linux/windows-msvc runners.
```

## NOTES
It is a toolchain problem, not a code problem: the prebuilt libraries target MSVC and Linux. Record which checks ran on which toolchain rather than calling a partial run "all tests pass".
