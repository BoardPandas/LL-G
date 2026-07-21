---
tech: rust
tags: [cargo, cargo-check, clippy, all-targets, cfg-test, refactor, ci]
severity: medium
---
# `cargo check` does not type-check test code, so a breaking rename looks clean

## PROBLEM
`cargo check` (and `cargo clippy`) default to the lib and bin targets only. `#[cfg(test)]` modules, `tests/`, `benches/`, and `examples/` are **not** compiled. After any breaking API change — renaming an enum variant, changing a function signature, changing a return type — `cargo check -p my-crate` can report a clean build while every test file referencing the old API is broken.

`cargo test` would catch it, so the gap usually closes on its own. It does **not** close when the crate cannot link on your dev machine — a GUI or platform crate whose system libraries are absent (`-lxdo`, `-lasound`, missing MSVC toolchain). There `cargo test` is unavailable, `cargo check` is the only tool you have, and it is silently ignoring exactly the code you most need checked. You then declare the refactor verified and hand over a workspace whose tests do not compile.

Real instance: splitting `FailStage::Gated` into two variants. `cargo check -p hark-app` was clean; a stale `FailStage::Gated` sat in a `#[cfg(test)]` block and only surfaced when clippy was later run with `--all-targets`.

## WRONG
```bash
# Checks lib + bins only. #[cfg(test)] modules and tests/ are invisible.
cargo check -p hark-app
#     Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.93s
# ... while crates/hark-app/src/pipeline.rs:269 still says FailStage::Gated
```

## RIGHT
```bash
# --all-targets adds tests, benches, and examples to the check.
cargo check --workspace --all-targets

# Better: clippy implies a check and adds lints, same flag.
cargo clippy --workspace --all-targets -- -D warnings

# Cross-compiling type-check for a platform you cannot link on: `check` never
# links, so no target toolchain/linker is needed -- only the target's std.
rustup target add x86_64-pc-windows-msvc
cargo check -p my-crate --all-targets --target x86_64-pc-windows-msvc
```

## NOTES
- Make `--all-targets` the default in CI and in any project instruction file. A bare `cargo check` in a contributor guide is a latent version of this bug.
- The same omission applies to `cargo fix` and to IDE/rust-analyzer configurations — rust-analyzer's `check.allTargets` defaults to true, so the editor may show errors your terminal `cargo check` does not, which is confusing in the opposite direction.
- The cross-compile trick in RIGHT fails if anything in the dependency graph builds C (e.g. `libsqlite3-sys` via `rusqlite`), because that *does* need a target C toolchain: `error occurred in cc-rs: failed to find tool "lib.exe"`. Check the affected crate alone rather than the whole workspace.
