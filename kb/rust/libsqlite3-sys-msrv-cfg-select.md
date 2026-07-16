---
tech: rust
tags: [rusqlite, libsqlite3-sys, msrv, toolchain, build-script, cfg_select, sqlite]
severity: high
---
# libsqlite3-sys 0.38.x requires Rust 1.95+ but declares no rust-version

## PROBLEM
libsqlite3-sys 0.38.1 (pinned as `^0.38.1` by rusqlite 0.40.1, so there is no downgrade escape hatch) uses the `cfg_select!` macro in its build script, which is unstable before Rust ~1.95. The crate declares no `rust-version`, so instead of a clear MSRV warning, an older toolchain fails the build with an opaque `E0658` (unstable feature) error pointing into a vendored dependency's build script. Nothing in the error says "update your toolchain", and the project's own code compiles fine, so the failure looks like a broken dependency rather than an old compiler. Verified 2026-07-16: 1.94.0 fails, 1.97.1 works.

## WRONG
```toml
# Cargo.toml -- assuming any recent-ish stable toolchain can build rusqlite
[dependencies]
rusqlite = { version = "0.40.1", features = ["bundled"] }
# rust-toolchain / CI pinned to an older stable (e.g. 1.94):
# build fails with E0658 "use of unstable library feature" inside
# libsqlite3-sys's build script, with no MSRV hint.
```

## RIGHT
```toml
# Update the toolchain first (rustup update), then declare the floor so the
# failure becomes a clear cargo MSRV error for everyone else:
[workspace.package]
# 1.97+: libsqlite3-sys 0.38.x (rusqlite bundled SQLite) uses cfg_select!,
# unstable before then. Verified on 1.97.1.
rust-version = "1.97"
```

## NOTES
General shape of the gotcha: a transitive dependency with no declared `rust-version` can raise your effective MSRV silently, and the symptom is an unstable-feature error in ITS build script, not yours. When an E0658 appears inside a registry crate after a dependency bump, suspect the toolchain before the crate.
