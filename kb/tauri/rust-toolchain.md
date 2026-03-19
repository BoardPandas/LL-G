---
tech: tauri
tags: [rust, installation, setup, windows]
severity: high
---
# Rust toolchain must be pre-installed for Tauri 2.x

## PROBLEM
Tauri 2.x requires the Rust toolchain (rustc, cargo) to be installed on the system. Running `pnpm tauri dev` or `pnpm tauri build` without Rust installed produces cryptic errors like "cargo: command not found" or silent failures. The Tauri npm packages (`@tauri-apps/cli`, `@tauri-apps/api`) install fine via pnpm but they are just JS wrappers -- the actual compilation requires a system-level Rust installation that is NOT managed by npm/pnpm.

## WRONG
```bash
# Assuming pnpm install handles everything
pnpm install
pnpm tauri dev  # FAILS: cargo not found
```

## RIGHT
```bash
# Install Rust toolchain first (Windows)
winget install Rustlang.Rustup
rustup default stable

# Then install JS deps and run
pnpm install
pnpm tauri dev  # Works
```

## NOTES
- On Windows, use `winget install Rustlang.Rustup` or download from rustup.rs
- First `pnpm tauri build` compiles ~450 Rust crates -- takes 2-5 minutes
- Subsequent builds are incremental and much faster
- The Rust toolchain is ~1GB installed
