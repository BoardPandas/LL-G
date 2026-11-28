---
tech: rust
tags: [tokio, oncecell, single-flight, cancellation, memory-leak, semaphore, timeout, backpressure]
severity: medium
---
# tokio: a single-flight map of OnceCell entries leaks a slot when every waiter is cancelled, and a semaphore wait as long as the holder's timeout never reports "busy"

## PROBLEM
Two concurrency traps that only show under cancellation or load:

1. **Leaked single-flight slots.** The usual single-flight shape is a `Mutex<HashMap<Key, Arc<OnceCell<V>>>>`: callers clone the entry's `Arc` under the lock and `get_or_try_init` outside it, and the winner removes the entry when done. If every waiter for a key is cancelled (the request futures are dropped), nobody reaches the removal, and the entry stays in the map forever, one per distinct key.
2. **A "busy" answer that cannot happen.** A handler waits for a semaphore permit with a timeout so it can answer "busy, try again". If that wait is as long as the timeout of the work the current holder is doing, the holder always finishes or times out first, the waiter always gets the permit, and the "busy" branch is unreachable. Callers queue for the full duration instead of being told quickly.

## WRONG
```rust
// 1. Entry removed only on the success path of whoever initialised it.
let cell = map.lock().await.entry(key.clone()).or_default().clone();
let v = cell.get_or_try_init(|| fetch(&key)).await?;   // all waiters cancelled here -> entry stays
map.lock().await.remove(&key);

// 2. Waiter and holder use the same duration.
let permit = timeout(WORK_TIMEOUT, sem.acquire()).await.map_err(|_| Busy)?;   // never Busy
```

## RIGHT
```rust
// 1. Under the SAME lock that hands out clones, prune entries nobody else holds.
let cell = {
    let mut m = map.lock().await;
    m.retain(|_, c| Arc::strong_count(c) > 1 || c.initialized());   // only the map holds it and it never completed
    m.entry(key.clone()).or_default().clone()
};

// 2. The wait for a permit is much shorter than the work it guards.
let permit = timeout(BUSY_AFTER, sem.acquire()).await.map_err(|_| Busy)?;   // BUSY_AFTER << WORK_TIMEOUT
```

## NOTES
- The prune must run under the lock that hands out clones; otherwise an entry can be removed between a caller's lookup and its clone.
- What counts as "nobody else holds it" depends on whether completed values stay cached in the map; the sketch keeps initialised cells and drops abandoned ones.
- Test the leak by starting waiters for many keys, dropping them all, and asserting the map is empty after the next call.
