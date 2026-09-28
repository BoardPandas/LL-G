---
tech: rust
tags: [windows, wdac, app-control, cargo-fmt, rustfmt, tooling, cargo-clippy, proc-macro, build-script]
severity: medium
---
# App Control can independently block Cargo wrappers and generated Rust binaries

## PROBLEM

On a managed Windows development machine, `cargo fmt` can fail with
`An Application Control policy has blocked this file. (os error 4551)` while
`rustfmt.exe` still runs. A wrapper refusal does not prove the formatter is
blocked; chaining formatting and linting also prevents the lint from running.

The allowed-artifact set can change. On Hark's development machine, later
refusals included `cargo-clippy.exe`, build-script executables in a fresh
`CARGO_TARGET_DIR`, and `target\debug\deps\yoke_derive-*.dll` proc macros.
An earlier successful build did not establish those artifacts remained allowed.

## WRONG

```text
Run cargo fmt && cargo clippy; infer both were checked from the single result.
rustfmt.exe works -> assume Cargo wrappers and generated binaries also work.
Linux checks pass -> claim Windows-only code compiled.
```

## RIGHT

```bash
# If rustfmt itself is permitted, pass the crate's edition explicitly.
# It follows module declarations from the crate root.
rustfmt --edition 2021 crates/my-crate/src/lib.rs
rustfmt --edition 2021 --check crates/my-crate/src/lib.rs
# Check all Rust files when replacing a workspace-wide format gate:
find crates -name '*.rs' -print0 | xargs -0 rustfmt --edition 2021 --check

# Run the lint independently; report a refusal if its wrapper is blocked.
cargo clippy --workspace --all-targets -- -D warnings
```

## NOTES

Read the refused artifact path and identify the gate that could not run.
Direct rustfmt does not read the edition from Cargo.toml. CI should still run
the real Cargo formatting gate to check workspace agreement.

Use an approved functioning environment for each affected target. WSL checks
Linux paths; Windows CI checks Windows paths. Report them separately. These
are observations on one managed machine, not a universal WDAC deny list. Do
not prescribe disabling App Control or relocating generated binaries as a
general workaround.

Evidence: [Hark's Core and real-call build observations](https://github.com/BoardPandas/Hark/blob/9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654/tasks/2026-09-26-plan-meeting-transcription.md),
section 8, recorded 2026-09-26 through 2026-09-28.
