---
tech: go
tags: [concurrency, sync-once, mutex, cache, fatal-error, race, invalidation]
severity: high
---
# Resetting a sync.Once by reassigning it is fatal, not just racy

## PROBLEM

`sync.Once` is not a resettable primitive. Assigning `sync.Once{}` over one is
the obvious way to invalidate a compute-once-and-cache value, and it works right
up until a second goroutine is inside `Do()`.

`Do()` holds the `Once`'s internal mutex for the entire duration of the function
it runs -- for a cache, that is the whole slow collection. Replacing the struct
hands that in-flight goroutine a zeroed mutex to unlock, and Go treats unlocking
an unlocked mutex as unrecoverable:

```
fatal error: sync: unlock of unlocked mutex
```

That is a **fatal error, not a panic**: `recover()` cannot catch it, no test
fails gracefully, the entire process dies. In a long-running service it is a
crash; under `go test` it kills the test binary.

Three things make it disproportionately hard to find:

- **The stack trace names the victim, not the culprit.** It points at the
  goroutine that was inside `Do()`, never at the one that reassigned the `Once`.
  The reported line is innocent code.
- **It is timing-dependent.** The reset has to land while a `Do()` is in flight,
  so it passes repeatedly and then fails. The commit that makes it reachable is
  usually the one that introduced *concurrency* (a goroutine, a scheduler),
  which is nowhere near the reset it exposed.
- **`go vet` does not flag it.** Its copylocks check catches copying a lock, but
  an assignment of a fresh zero-value literal reads as a plain write. A tree
  carrying this bug can pass `go vet ./...` and `gofmt -l .` completely clean.

## WRONG

```go
var (
	cacheOnce sync.Once
	cacheData *report
)

func load() *report {
	cacheOnce.Do(func() {
		cacheData = &report{}
		// Holds the Once's mutex for as long as this takes -- seconds.
		out, err := exec.Command("powershell", "-Command", script).Output()
		if err == nil {
			_ = json.Unmarshal(out, cacheData)
		}
	})
	return cacheData
}

// Called between scheduled collections so the next read re-reads the machine.
func ResetCache() {
	cacheOnce = sync.Once{} // replaces the mutex a live goroutine is holding
	cacheData = nil
}
```

## RIGHT

```go
var (
	cacheMu   sync.Mutex
	cacheData *report
)

func load() *report {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	if cacheData != nil {
		return cacheData
	}

	// Publish before the slow call, so a failed attempt is not retried on every
	// call until the next reset -- the behaviour Once.Do gave for free.
	cacheData = &report{}
	out, err := exec.Command("powershell", "-Command", script).Output()
	if err == nil {
		_ = json.Unmarshal(out, cacheData)
	}
	return cacheData
}

func ResetCache() {
	cacheMu.Lock()
	defer cacheMu.Unlock()
	cacheData = nil // reset the contents, never the lock
}
```

## NOTES

- The rule generalises: **replace the contents under a lock, never the lock
  itself.** Any `sync.Mutex`/`RWMutex`, or a struct embedding one, reachable by
  another goroutine has the same failure mode.
- There is no resettable `Once` in the standard library. A mutex plus a nil
  check *is* the whole pattern -- do not reach for something cleverer.
- **Preserve the failure semantics when converting.** `Once.Do` runs the
  function exactly once even when it fails, so a failed computation is not
  retried until the next reset. A naive rewrite that only caches on success
  turns one failed collection into a fresh subprocess on every single call.
  Publishing the empty value before the slow call keeps the original contract.
- `go test -race` can catch the underlying unsynchronised write, but only if the
  overlap actually occurs in that run -- and the fatal error may kill the process
  first. Do not treat one green run as proof.
- If two independent caches are reset together, release the first lock before
  taking the second rather than nesting them; nesting invents a lock ordering
  for later callers to get wrong.
- Observed 2026-08-13 in the SupportForge desktop agent: `inventory.ResetCache()`
  reset two `sync.Once` caches at the top of every scheduled report. It was
  harmless while the collectors were only constructed, and started killing the
  agent process intermittently -- and taking CI down -- as soon as they ran on a
  schedule with overlapping reporters.
