---
tech: rust
tags: [rust-embed, debug-embed, std-fs, blocking, async, build-script, rerun-if-changed, cargo, incremental-build]
severity: medium
---
# rust-embed 8: debug builds read files with std::fs at request time unless debug-embed is enabled, and cargo:rerun-if-changed on a missing path makes every build dirty

## PROBLEM
Two build-time surprises when embedding a web app's files into a binary:

1. **Debug builds do not embed.** With `rust-embed` 8, a debug build reads each file from disk with `std::fs` when it is requested, unless the `debug-embed` feature is on. Inside an async handler that is blocking I/O on the executor, and the debug binary behaves differently from release: it needs the source directory at run time, and it picks up files changed after the build. Tests that run in debug are then not testing what ships.
2. **A missing rerun path defeats caching.** A build script that prints `cargo:rerun-if-changed=<path>` for a path that does not exist (for example the web build's output directory before the first web build) makes Cargo consider the crate dirty on **every** build, so the crate and everything depending on it recompile each time.

## WRONG
```toml
[dependencies]
rust-embed = "8"            # debug: files read with std::fs per request
```
```rust
// build.rs
println!("cargo:rerun-if-changed=../web/dist");   // does not exist yet -> always dirty
```

## RIGHT
```toml
[dependencies]
rust-embed = { version = "8", features = ["debug-embed"] }   # debug embeds, same as release
```
```rust
// build.rs: only name paths that exist.
let dist = std::path::Path::new("../web/dist");
if dist.exists() {
    println!("cargo:rerun-if-changed={}", dist.display());
} else {
    println!("cargo:rerun-if-changed=build.rs");
}
```

## NOTES
- Symptom of the second problem: `cargo build` run twice in a row recompiles the same crate both times.
- If the directory can appear later (the web build runs after the first cargo build), create it before building or watch a path that already exists, so its arrival still triggers a rebuild.
- Related: `blocking-io-on-tokio.md` on this shelf.
