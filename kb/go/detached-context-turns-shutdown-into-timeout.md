---
tech: go
tags: [context, cancellation, shutdown, waitgroup, exec, subprocess, goroutine, graceful-shutdown]
severity: high
---
# A detached `context.Background()` under a WaitGroup turns graceful shutdown into a timeout

## PROBLEM

A worker goroutine registered in a shutdown `WaitGroup` is only as cancellable as the deepest blocking call beneath it. If any helper down that stack builds its context from `context.Background()` -- even with its own generous timeout -- then cancelling the parent cannot reach it, `wg.Wait()` blocks until that helper finishes on its own schedule, and the shutdown path falls through to its timeout branch.

Nothing fails. The timeout branch logs a warning and the process exits, so tests pass, `go vet` is clean, coverage shows no gap, and the only symptom is that shutdown is *slow*. Slow shutdown reads as "it has a lot to clean up", which is why this survives for years.

**The tell is the shape of the delay, not its size: shutdown takes *exactly* the timeout constant, to the millisecond, every time.** A real dependency -- a slow network flush, a large write -- varies. A run of identical durations that equal a constant in your own source is not work; it is a cancellation that never arrived.

It is worst with `os/exec`. Cancelling a context the child process does not have cannot kill the child, so the parent parks in `cmd.Wait()` inside a syscall, where no `select` will ever look at your done channel.

Seen live: a desktop agent's inventory reporter, tracked in the agent's `WaitGroup`, collected hardware through a PowerShell CIM script built on `context.WithTimeout(context.Background(), 90*time.Second)`. `Agent.Stop()` therefore took a flat 15 seconds -- its entire shutdown ceiling -- on every service stop, uninstall and auto-update restart, logging "shutdown timed out, forcing exit" each time. What finally exposed it was the test suite: six tests in one package each burned 15.03-15.18s, and six identical durations are not six slow tests.

To find it, dump goroutines at the moment of the hang: `go test -timeout <less than the ceiling>` panics and prints every stack. Read for the goroutine parked in a **syscall** rather than in a `select` -- that one is holding the WaitGroup.

## WRONG

```go
// Several layers below the worker, in a helper nobody thinks of as concurrent.
func loadHardware() *report {
	// Detached. The caller's cancellation cannot reach this, and the 90s is
	// the ceiling for a wedged provider -- not a shutdown budget.
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", script)
	out, err := cmd.Output()
	// ...
}

func (a *Agent) Start() {
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		reporter.Run(a.ctx) // ctx is honoured HERE -- and nowhere below it
	}()
}

func (a *Agent) Stop() {
	a.cancel() // reaches the loop, not the child process
	close(a.done)

	finished := make(chan struct{})
	go func() { a.wg.Wait(); close(finished) }()

	select {
	case <-finished:
	case <-time.After(shutdownTimeout): // <- taken every single time, in full
		log.Warn("shutdown timed out, forcing exit")
	}
}
```

## RIGHT

```go
func loadHardware(ctx context.Context) *report {
	// Parented. Keeps its own ceiling for a provider that wedges when nothing
	// is cancelling, and dies immediately when something is.
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "powershell", "-NoProfile", "-Command", script)
	// Not optional: without WaitDelay, Wait still blocks on the inherited
	// stdout/stderr pipe handles after the process itself has been killed,
	// which reintroduces the very block this change removes.
	cmd.WaitDelay = 5 * time.Second

	out, err := cmd.Output()
	// ...
}
```

Where threading a `ctx` argument through every layer is genuinely impractical -- dozens of helpers that read a cache and never spawn anything -- bind the scope once at the package's entry points instead, and have only the spawn sites read it:

```go
var (
	scopeMu sync.RWMutex
	scope   = context.Background()
)

// Called at the top of each exported entry point. Nil-safe, and defaults to
// Background so a caller that bypasses the entry point behaves as it did
// before rather than failing closed.
func beginScope(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	scopeMu.Lock()
	scope = ctx
	scopeMu.Unlock()
}

func commandContext(timeout time.Duration) (context.Context, context.CancelFunc) {
	scopeMu.RLock()
	parent := scope
	scopeMu.RUnlock()
	return context.WithTimeout(parent, timeout)
}
```

That is package-level mutable state and should be argued for, not reached for: it is defensible only when its lifetime already matches something the package keeps at package level (a per-run cache, reset by the same caller), and only under its own lock.

## NOTES

- Audit with `grep -rn 'context.Background()' --include='*.go'` and check every hit reachable from a `WaitGroup`-tracked goroutine. `context.TODO()` hides exactly the same defect and greps differently.
- A plain `exec.Command` is strictly worse than a detached `CommandContext` -- it cannot be cancelled at all, and a hand-rolled `time.After` + `Process.Kill()` bounds the wait without making it cancellable. Both look like they have a timeout.
- Write the regression test against the *cancellation*, not the worker: a stub that honours the context it is handed will pass against the broken code too, because the plumbing above the defect was never the problem. Prove the test by reverting the fix and watching it fail.
- Related: [preserve-windows-process-token](preserve-windows-process-token.md) -- these are the same call sites, and replacing `SysProcAttr` while editing them drops `HideWindow`/`CREATE_NO_WINDOW`.
- An aside that costs an hour *before* you reach the bug, when the symptom arrives as a slow CI step: `go test ./...` prints package results in package-list order, not completion order. One slow package early in the list makes every package behind it -- including cached ones that finished instantly -- appear hung, then dump in a single burst.
