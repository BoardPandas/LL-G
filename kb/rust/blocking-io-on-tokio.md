---
tech: rust
tags: [tokio, async, blocking, filesystem, exists, performance]
severity: high
---
# Blocking std::fs calls on Tokio runtime starve the executor

## PROBLEM

`std::path::Path::exists()`, `metadata()`, `read_dir()`, and other `std::fs` functions perform synchronous I/O. When called on a Tokio async runtime (inside an `async fn`), they block the executor thread. With a default thread pool of `num_cpus` threads, scanning a directory with many entries can block ALL executor threads, stalling every other async task (network, timers, UI events).

This is especially dangerous in Tauri apps where the same runtime handles IPC, window events, and your scanning logic.

## WRONG

```rust
async fn scan_directory(path: &Path) -> Vec<PathBuf> {
    let mut repos = Vec::new();
    // std::fs::read_dir blocks the Tokio thread
    for entry in std::fs::read_dir(path).unwrap() {
        let entry = entry.unwrap();
        // Path::exists() blocks again
        if entry.path().join(".git").exists() {
            repos.push(entry.path());
        }
    }
    repos
}
```

## RIGHT

Use `tokio::fs` equivalents throughout async functions:

```rust
async fn scan_directory(path: &Path) -> Result<Vec<PathBuf>, std::io::Error> {
    let mut repos = Vec::new();
    let mut entries = tokio::fs::read_dir(path).await?;
    while let Some(entry) = entries.next_entry().await? {
        if tokio::fs::try_exists(entry.path().join(".git"))
            .await
            .unwrap_or(false)
        {
            repos.push(entry.path());
        }
    }
    Ok(repos)
}
```

Alternatively, use `tokio::task::spawn_blocking` to run std::fs code on a dedicated blocking thread pool:

```rust
let repos = tokio::task::spawn_blocking(move || {
    // std::fs is fine here -- this runs on a blocking thread
    std::fs::read_dir(&path).unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().join(".git").exists())
        .map(|e| e.path())
        .collect::<Vec<_>>()
}).await?;
```

## NOTES

- `tokio::fs::try_exists` was stabilized in Tokio 1.33+.
- Clippy does not catch this by default. The `clippy::unused_async` lint catches the opposite (async functions that never await), but not sync-in-async.
- Discovered in RepoTracker `scan.rs` during code review where `entry_path.join(".git").exists()` was used inside `tokio::fs::read_dir` iteration.
