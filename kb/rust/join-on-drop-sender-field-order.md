---
tech: rust
tags: [threads, channels, drop-order, joinhandle, deadlock, mpsc, shutdown]
severity: high
---
# A JoinHandle joined in Drop deadlocks when a later-dropped field still holds a sender to the worker

## PROBLEM
A common shutdown pattern: a handle struct owns a worker `JoinHandle` and joins it in `Drop` (after dropping its own `Sender`) so the worker's final writes complete before the process exits. The worker loops on `while let Ok(cmd) = rx.recv()`, which only ends when EVERY `Sender` clone is gone. Rust drops struct fields in declaration order, so if any field declared AFTER the joining handle (or a subsystem it owns, like a pump thread) still holds a `Sender` clone, `Drop` joins a worker whose channel can never disconnect: the app hangs on exit with no error, no panic, and nothing in the logs. The hang is timing-dependent when the other sender lives on a thread, which makes it look like a flaky freeze rather than a structural bug.

## WRONG
```rust
struct App {
    storage: StorageHandle,       // Drop: drops its Sender, then joins worker
    pipeline: PipelineController, // ALSO holds a Sender clone (e.g. via a
                                  // forwarding/pump thread) -- declared after,
                                  // so it drops after: join waits forever
}

impl Drop for StorageHandle {
    fn drop(&mut self) {
        self.tx.take();                       // our sender gone...
        if let Some(w) = self.worker.take() {
            let _ = w.join();                 // ...but pipeline's clone lives
        }
    }
}
```

## RIGHT
```rust
struct App {
    // Field order IS the shutdown order: everything holding a sender clone
    // to the worker is declared (and therefore dropped) BEFORE the handle
    // that joins it. Document the ordering; a well-meaning reorder
    // reintroduces the hang.
    pipeline: PipelineController, // drops first: pump thread exits, its
                                  // Sender clone drops
    storage: StorageHandle,       // now recv() disconnects; join returns
}
```

## NOTES
- The same rule applies transitively: a spawned thread holding a `Sender` counts as a holder until that thread exits; make sure dropping the earlier field actually terminates it (e.g. the pump exits when its own upstream channel disconnects).
- Alternatives when strict ordering is impractical: send an explicit `Shutdown` message and have the worker break out of the loop regardless of remaining senders, or use `Weak`-style sender wrappers. Ordering is the zero-cost option when the ownership graph allows it.
- Found at Hark Phase 4 CP4 (2026-07-16): the storage worker join is deadlock-free only because the pipeline controller (whose event pump holds a storage sender) is declared before the storage handle.
