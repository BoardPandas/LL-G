---
tech: go
tags: [concurrency, shutdown, context, cleanup, windows, resource-lifecycle, named-pipe, go-winio]
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

## WRONG (before the select)

The same hang happens when the synchronous join runs *before* the select. A
request step that closes a resource whose Close joins in-flight IO sits ahead of
the deadline, so the deadline bounds nothing. go-winio pipe Close cancels and
then waits for every in-flight operation, and a listener Close that waits on a
WaitGroup of admitted reads behaves the same way. One read that never settles
makes Retire, and every Stop that calls BeginRetire, unbounded.

```go
func (o *Owner) requestRetirement() {
    o.fence()
    o.cancel()
    o.listener.Close() // Joins every admitted pipe read.
    o.conn.Close()     // go-winio: cancel, then wait for in-flight IO.
}

func (o *Owner) Retire(ctx context.Context) error {
    o.requestRetirement() // Can block forever here...
    select {              // ...so this deadline is never reached.
    case <-ctx.Done():
        return ctx.Err()
    case <-o.done:
        return o.result
    }
}
```

The request step must only fence admission, start any independent cleanup and
cancel. It starts the one completion goroutine, which does every close and join
and then closes `done`:

```go
func (o *Owner) requestRetirement() {
    o.fence()
    o.mu.Lock()
    if o.retiring { // Repeated requests must not pile goroutines on a sync.Once.
        o.mu.Unlock()
        return
    }
    o.retiring = true
    o.mu.Unlock()
    o.cancel()
    go o.finish() // Closes listener/conn, joins, publishes result, close(o.done).
}
```

This also lets an owner that was never started complete; otherwise nothing
ever closes `done` and Retire always runs to its deadline.

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
- Seen twice in one codebase, both before the select: a capture-broker owner
  whose host died at a Windows sign-out left the service silent with no close
  evidence or re-host, and a sibling font-bridge owner had the identical
  request step. The test fake is a pipe conn whose Read blocks until released
  and whose Close waits for that release. Assert Retire with a 200ms deadline
  returns cleanup debt promptly, BeginRetire returns promptly, `done` stays
  open, and that after release a later Retire succeeds with cleanup run once.
