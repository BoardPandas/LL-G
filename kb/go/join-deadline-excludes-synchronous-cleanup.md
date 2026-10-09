---
tech: go
tags: [concurrency, shutdown, context, cleanup, windows, resource-lifecycle]
severity: high
---
# A join deadline excludes synchronous cleanup after the wait

## PROBLEM

A shutdown method can select between a worker-completion channel and a context
deadline, then hang indefinitely in a synchronous release call after the select.
The deadline bounds only the first wait. Cleanup can still block on a mutex held
by a persistence worker or inside a native flush/close operation. Tests that only
hold a worker open miss this because they never block the release itself.

This appeared while adding Windows policy recovery: closing the protected store
needed a mutex shared with durable audit acknowledgment. The workers could be
drained while the close still waited, so a nominally bounded Join did not return.

## WRONG

```go
func (s *Service) Join(ctx context.Context) error {
    s.BeginRetire() // Prevent new work and cancel existing workers.
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-s.workersDone:
    }
    return s.release() // Outside the deadline; may block indefinitely.
}
```

## RIGHT

```go
func (s *Service) Join(ctx context.Context) error {
    s.BeginRetire() // Admission must close before Wait starts.
    s.joinOnce.Do(func() {
        s.drained = make(chan struct{})
        go func() {
            s.work.Wait()
            s.releaseErr = s.release()
            close(s.drained)
        }()
    })
    select {
    case <-ctx.Done():
        return ctx.Err()
    case <-s.drained:
        return s.releaseErr
    }
}
```

## NOTES

- One service-owned completion goroutine performs release once. Repeated Join
  calls observe the same completion; a timed-out caller does not abandon cleanup
  or start another release attempt. Closing the channel publishes releaseErr.
- Returning on a deadline does not establish cleanup success and cannot cancel
  an uninterruptible native operation. Keep any reservation and recovery debt
  until the release owner can confirm the underlying work has settled.
- A regression test must block release after the worker wait finishes, assert
  that Join returns on its deadline while ownership is retained, then unblock
  release and verify that a later Join completes and release ran exactly once.
- This complements [parenting worker contexts](detached-context-turns-shutdown-into-timeout.md):
  cancellable workers alone do not bound the cleanup that follows them.
