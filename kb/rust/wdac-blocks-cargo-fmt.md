---
tech: rust
tags: [windows, wdac, app-control, cargo-fmt, rustfmt, tooling]
severity: medium
---
# An App Control (WDAC) policy can block cargo-fmt.exe while rustfmt.exe still runs

## PROBLEM
On a managed Windows dev box, `cargo fmt` fails with `'cargo-fmt': An Application Control policy has blocked this file. (os error 4551)`. It looks like formatting is impossible, but the policy covers the `cargo-fmt.exe` wrapper, not `rustfmt.exe`. Chaining `cargo fmt && cargo clippy` also means clippy never runs.

## WRONG
```bash
cargo fmt --all && cargo clippy --all-targets -- -D warnings
```

## RIGHT
```bash
# Format: rustfmt follows `mod` declarations from each crate root.
rustfmt --edition 2021 crates/my-crate/src/lib.rs
# Check the whole workspace the way `cargo fmt --all -- --check` would:
find crates -name '*.rs' -print0 | xargs -0 rustfmt --edition 2021 --check
cargo clippy --all-targets -- -D warnings   # run separately, not chained
```

## NOTES
Pass the edition explicitly, because rustfmt run directly does not read it from Cargo.toml. CI still runs the real `cargo fmt --check`, so the two stay in agreement.
