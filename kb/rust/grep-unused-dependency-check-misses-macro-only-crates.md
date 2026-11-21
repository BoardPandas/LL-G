---
tech: rust
tags: [cargo, dependencies, unused-dependencies, proc-macro, windows-rs, windows-core, implement, dependency-audit]
severity: high
---
# Grep-based unused-dependency checks miss crates used only by macro expansion

## PROBLEM
A dependency audit that greps the source for each crate's import path flags a crate as unused when nothing in the source names it, though a macro's expansion does. The common case is `windows-core` next to the `windows` crate. `#[windows::core::implement(...)]` expands to `::windows_core::...` paths, so a crate that implements a COM interface must list `windows-core` directly, even though no file mentions `windows_core`. Remove it and the build breaks, but only on Windows, so a Linux or macOS machine that "verified" the removal sees nothing.

A second trap comes with it: crates.io offers `windows-core` versions far ahead of `windows` (0.100 while `windows` is still 0.62.2). Bumping `windows-core` on its own pulls in a second copy, and `#[implement]` then targets that copy's traits, so the interface impls no longer match. `windows-core` must stay on the line the `windows` crate itself depends on.

## WRONG
```bash
# "No references found, so remove it" (or "outdated, so bump it")
grep -rw windows_core crates/my-audio/src || echo "unused: windows-core"
```
```toml
windows = { version = "0.62.2", features = ["Win32_Media_Audio"] }
windows-core = "0.100"   # bumped alone: second copy, #[implement] hits the wrong traits
```

## RIGHT
```toml
windows = { version = "0.62.2", features = ["Win32_Media_Audio"] }
# Needed by #[implement]'s expansion even though no source line names it.
# Keep on the windows crate's own line; move both together.
windows-core = "0.62"
```
```bash
# Before calling a dependency unused, compile without it on every target that uses it
cargo check --target x86_64-pc-windows-gnu -p my-audio
# and confirm a version bump keeps one copy
cargo tree -d -i windows-core --target x86_64-pc-windows-msvc
```

## NOTES
- The same blind spot covers any crate that only macro output references, such as `serde` under some derive setups or a `*-derive` crate's runtime support crate. A grep can show that a crate *is* used. It cannot show that a crate is unused.
- Leave a comment on the manifest line saying why the crate is there. The comment is what stops the next audit from "fixing" it.
