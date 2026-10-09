---
tech: go
tags: [concurrency, context, deadline, shutdown, cleanup, named-pipes, go-winio, supervisor, logging]
severity: high
---
# A retirement request that closes synchronously defeats the deadline select after it

## PROBLEM
`Retire(ctx)` looks bounded: it selects on `ctx.Done()` versus a completion
channel. But it first calls a "request" step, and that step closes the
transport synchronously. If `Close` joins in-flight work, the code never
reaches the select. In SupportForge, `Listener.Close` waited for every admitted
pipe read plus the process monitor, and go-winio's `Close` cancels and then
*waits* for in-flight IO. One pipe read that never settled therefore made
`Retire` unbounded. It also made `BeginRetire` unbounded, and `Stop` calls that
before it closes the host's kill-on-close job.

No error and no log appeared. After a Windows sign-out the remote-session
supervisor simply went silent (MX1-2021, 2026-10-08): no close evidence, no
cleanup-debt warning, no re-host. This is a variant of
`join-deadline-excludes-synchronous-cleanup.md`. There the unbounded join sits
*after* the wait; here it sits *before* the select, hidden inside a step named
like a non-blocking request.

## WRONG
```go
func (o *Owner) requestRetirement() {
	o.mu.Lock()
	if o.retiring { o.mu.Unlock(); return }
	o.retiring = true
	listener, conn := o.listener, o.conn
	o.mu.Unlock()
	o.cancel()
	_ = listener.Close() // joins admitted reads: unbounded
	_ = conn.Close()     // go-winio: cancel, then wait for in-flight IO
	go o.complete(nil)
}

func (o *Owner) Retire(ctx context.Context) error {
	o.requestRetirement() // may never return
	select {
	case <-ctx.Done():
		return errors.Join(ErrCleanup, ctx.Err())
	case <-o.done:
		return o.result()
	}
}
```

## RIGHT
```go
// The request only fences and cancels. It never joins.
func (o *Owner) requestRetirement() {
	o.mu.Lock()
	if o.retiring { o.mu.Unlock(); return }
	o.retiring = true
	o.mu.Unlock()
	o.cancel()         // derived transports see ctx and fence themselves
	go o.complete(nil) // the one owner of every Close/join, then close(o.done)
}

func (o *Owner) Retire(ctx context.Context) error {
	o.requestRetirement()
	select {
	case <-ctx.Done(): // debt reported; owner stays unsettled until done closes
		return errors.Join(ErrCleanup, ctx.Err())
	case <-o.done:
		return o.result()
	}
}
```

## NOTES
- Audit everything that runs before a deadline `select`. The suspects are
  `Close`, `retire()`, `sync.Once` bodies and `WaitGroup.Wait`. A name like
  `requestX` or `BeginX` promises nothing about blocking.
- `BeginRetire`/`Stop` must also be non-blocking. If containment such as
  closing a kill-on-close job waits behind a join, a still-running process is
  never stopped and `Wait` never returns.
- A timed-out retirement must keep the debt. Leave `CleanupSettled()` false
  until the join really finishes, so a replacement stays fenced.
- Regression test: build a fake pipe whose `Read` ignores `Close` and whose
  `Close` waits for that `Read`. Assert that `Retire(200ms)` returns cleanup
  debt and that `BeginRetire` returns promptly. Then release the read and
  assert that a later `Retire` succeeds with cleanup run exactly once.
- Observability that would have localized it:
  - Log the awaited event (`host exited`) before the cleanup that follows it.
  - Give a supervisor goroutine one deferred "stopped" line with a reason.
  - Report any `Retire` that overruns its deadline, and keep waiting.
- Fixed in BoardPandas/supportforge-platform `4166aff47`
  (`internal/sessionipc/capture_bridge_owner.go`).
