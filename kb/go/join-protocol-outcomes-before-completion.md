---
tech: go
tags: [concurrency, sync-once, shutdown, ipc, acknowledgments, cleanup]
severity: high
---
# Join protocol outcomes before publishing one-time completion

## PROBLEM

A retirement path and a protocol loop can race to the same `sync.Once`. If
retirement supplies a nil result first, the later protocol failure is silently
discarded. The final completion channel closes successfully even though an
acknowledgment was rejected or never confirmed.

Closing the transport may join pending IO without joining the application code
that classifies the IO result afterward. Therefore "Close returned" is not proof
that the protocol outcome has been incorporated. The race detector can stay
quiet: every access may be synchronized while the selected result is wrong.

In SupportForge, making retirement asynchronous correctly bounded a stuck pipe
join, but let its nil completion beat a rejected final font-bridge reply. The
existing regression failed 19 of 20 focused baseline runs.

## WRONG

```go
func (o *owner) finish(protocolErr error) {
    o.once.Do(func() {
        o.closeAndJoinTransport()
        o.result = protocolErr
        close(o.done)
    })
}

// Protocol goroutine:
o.finish(classifyFinalReply())

// Concurrent retirement:
go o.finish(nil) // Winning Once discards the protocol goroutine's later error.
```

Neither calling `finish` synchronously from retirement nor writing `o.result`
after `done` closes repairs the contract. The first can block before the caller's
deadline select; the second changes a result already observed by other callers.

## RIGHT

Publish the one protocol producer's outcome independently. One completion owner
then joins that producer before publishing the immutable overall result.

```go
// The accept/serve goroutine is the only writer.
func (o *owner) finishServing(err error) {
    o.protocolErr = err
    close(o.protocolDone)
    o.requestCompletion()
}

func (o *owner) requestCompletion() {
    o.once.Do(func() {
        go func() {
            cleanupErr := o.joinHelperCleanup()
            transportErr := o.closeAndJoinTransport()
            if o.started { // Frozen under the admission fence before this worker.
                <-o.protocolDone
            }
            o.result = errors.Join(o.protocolErr, cleanupErr, transportErr)
            close(o.done)
        }()
    })
}

func (o *owner) Retire(ctx context.Context) error {
    o.fenceAdmission()
    o.cancel()
    o.requestCompletion() // No blocking close/join before the deadline select.
    select {
    case <-ctx.Done():
        return errors.Join(ErrCleanupPending, ctx.Err())
    case <-o.done:
        return o.result
    }
}
```

The result write precedes the producer-channel close, and the consumer waits on
that channel before reading it. The producer must publish before requesting
completion, so the once-owned completion cannot wait on a producer blocked inside
the same `Once.Do`.

## NOTES

- Freeze start/admission state under the owner mutex. A never-started owner has no
  producer to await; a started listener must publish its accept failure or its
  serve result. Cancellation must wake accept, and late accepted resources still
  need an owned close/join.
- Preserve semantic errors such as "unconfirmed" even when joined with an
  expected retirement error such as `net.ErrClosed`. Error normalization must
  not turn missing protocol proof into success.
- Keep cleanup and completion lifetime-owned when callers time out. Do not
  prematurely close `done`, abandon unresolved ownership, or add an overlapping
  cleanup worker.
- Reproduce the gap deterministically: hold the final read after transport IO
  completes but before protocol classification; call Retire; require bounded
  pending cleanup and an open Done; release the barrier; require every concurrent
  observer to receive the same final result. Include accepted, rejected and
  rejected-plus-transport-closure replies, pending accept and never-started cases.
- [Fix and regression tests](https://github.com/BoardPandas/supportforge-platform/commit/ce84cb254512c6de8ecf083a224f63bd86753708).
  The new `TestFontBridgeRetirementJoinsFinalProtocolResult` failed all three
  barrier cases before the repair. Afterward, font-bridge checks passed 100
  shuffled Linux repetitions, 20 race-enabled repetitions and 20 isolated Windows
  repetitions on MSI. These are protocol/lifecycle tests, not proof of native
  font effects or remote-video acceptance.
- Related: [unbounded retirement requests](retire-request-joins-before-deadline-select.md)
  and [cleanup outside a join deadline](join-deadline-excludes-synchronous-cleanup.md).
- This is a behavioral Go concurrency defect, not a configuration defect.
  Deterministic regression tests enforce the ownership contract; no static Codex
  or Claude configuration guard is appropriate.

