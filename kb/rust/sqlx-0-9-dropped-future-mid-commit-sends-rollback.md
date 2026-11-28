---
tech: rust
tags: [sqlx, postgres, transaction, commit, rollback, cancellation, dropped-future, tokio-spawn]
severity: medium
---
# sqlx 0.9: dropping a request future mid-COMMIT leaves sqlx believing the transaction is open, so its cleanup sends ROLLBACK

## PROBLEM
If the future awaiting `tx.commit()` is dropped while the `COMMIT` is in flight (the client disconnected, a timeout layer fired, the server is shutting down), sqlx 0.9 still considers the transaction open. Its cleanup then sends `ROLLBACK` on that connection. Postgres has usually finished the `COMMIT` by then and logs:

```text
WARNING:  there is no transaction in progress
```

The application learns nothing: the caller that would have seen the commit's result is gone. Whether the data was committed depends on where the cancellation landed.

## WRONG
```rust
async fn handler(State(pool): State<PgPool>) -> Result<Response, Error> {
    let mut tx = pool.begin().await?;
    // ... writes ...
    tx.commit().await?;        // this future is dropped if the client goes away
    Ok(ok())
}
```

## RIGHT
```rust
// Run commit (and explicit rollback) in their own task, so they finish
// even when the caller's future is dropped.
let committed = tokio::spawn(async move { tx.commit().await });
committed.await.map_err(Error::Join)??;
```

## NOTES
- The spawned task runs to completion whether or not anyone is still awaiting the `JoinHandle`, so the transaction always reaches a definite end and sqlx's view of the connection stays correct.
- Do the same for an explicit `tx.rollback()`.
- If the server drains tasks on shutdown, make sure these tasks are among the ones it waits for.
