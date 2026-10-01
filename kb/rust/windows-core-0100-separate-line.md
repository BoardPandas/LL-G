---
tech: rust
tags: [windows-rs, windows-core, implement, com, cargo, versioning]
severity: medium
---
# windows-core 0.100 is a separate windows-rs line from windows 0.62

## PROBLEM
crates.io and outdated tools report windows-core 0.100.0 as the latest, while the `windows`
crate itself is still 0.62.2, which depends on windows-core 0.62. Following the
"latest" bump on a direct `windows-core` dependency (needed for `#[implement]`) pulls in
a second windows-core, so the macro's traits no longer match the `windows` crate's
interfaces. It fails only when compiling for a Windows target, so a Linux/macOS dev
loop looks clean.

## WRONG
```toml
windows = "0.62.2"
windows-core = "0.100"   # "latest" per cargo outdated
```

## RIGHT
```toml
windows = "0.62.2"
windows-core = "0.62"    # must match the windows crate's own windows-core
```

## NOTES
Verified 2026-10-01. Check `cargo tree -i windows-core` for duplicates, and run
`cargo check --target x86_64-pc-windows-gnu` before accepting a windows-rs bump.
