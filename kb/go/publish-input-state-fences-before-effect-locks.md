---
tech: go
tags: [concurrency, mutex, input, remote-control, cancellation, revisions]
severity: high
---
# Publish input-state fences before waiting on effect locks

## PROBLEM

A remote input event can be queued behind another participant's use of a shared
injector while already holding its own peer effect mutex. If mute or focus loss
needs that same effect mutex before publishing its new state, the old key event
gets to inject first. All fields can be protected correctly and the Go race
detector can stay green: this is an ordering bug, not a data race.

Checking mute before waiting for a lock is also insufficient. Rapid mute and
re-enable adds a second trap: an old cleanup callback can release keys that were
pressed after control was re-enabled, or a queued old event can become valid again.

## WRONG

```go
// Sketch: the queued input callback can already own effectMu and be waiting
// for shared.mu. Mute cannot publish until that input has already injected.
peer.effectMu.Lock()
defer peer.effectMu.Unlock()
shared.mu.Lock()
defer shared.mu.Unlock()
peer.muted = true
return releaseThisPeerInputs()
```

## RIGHT

Use a small state-publication lock separate from both effect serialization and
the shared injector. Track a published revision and a cleanup-applied revision.
Publishing can only deny old input; it must not by itself enable new input.
Perform current peer/generation/grant checks before publication and again after
waiting for serialization. The following sketches omit those surrounding checks.

```go
stateMu.Lock()
if revision <= publishedRevision {
    stateMu.Unlock()
    return errStale
}
publishedRevision, muted, focused = revision, wantsMuted, hasFocus
stateMu.Unlock()

peer.effectMu.Lock()
defer peer.effectMu.Unlock()
shared.mu.Lock()
defer shared.mu.Unlock()

stateMu.Lock()
current := publishedRevision == revision
stateMu.Unlock()
if !current {
    return errStale // Never let obsolete cleanup release newer keys.
}
if err := releaseThisPeerInputs(); err != nil {
    return err // Retain uncertain ownership; do not claim successful cleanup.
}
stateMu.Lock()
defer stateMu.Unlock()
if publishedRevision != revision {
    return errStale
}
appliedRevision = revision
```

Inside the input callback, after acquiring shared serialization and rechecking
live authority, accept only its exact current, cleanup-applied revision:

```go
stateMu.Lock()
allowed := eventRevision == publishedRevision &&
    eventRevision == appliedRevision && !muted && focused
stateMu.Unlock()
if !allowed {
    return errSuppressed
}
return injectOwnedInput()
```

## NOTES

- Re-enable must also complete the current generation's old-input cleanup before
  advancing appliedRevision. A superseded mute may never have performed cleanup.
- An effect already admitted cannot be undone. Cleanup waits for serialized
  effects and only acknowledges when the owner's held input is actually released.
- Release only this peer's ownership. Another participant holding the same
  physical key must not receive an early key-up.
- Deterministic regression: block peer B inside the shared injector; queue peer
  A's key event until it owns A's effect mutex; publish A's mute; require the new
  revision to be observable before unblocking B. A's queued event must be refused.
  Repeat with mute immediately superseded by re-enable and verify that an old
  cleanup cannot release a new-generation key.
- The named regressions are
  `TestInputMuteFencesAnEventAlreadyWaitingForSharedInjector` and
  `TestInputReenableCannotReviveQueuedEventsOrStaleCleanup` in
  `desktop_agent_v2/internal/remotecontrol/collaboration/input_concurrency_test.go`.
  Implementation record: [SupportForge #276 checkpoint evidence](https://github.com/BoardPandas/supportforge-platform/issues/276#issuecomment-5736608422).
  At publication these tests belong to a local, unpushed C4b checkpoint, so there
  is intentionally no GitHub source link claiming the files are already remote.
- This is a technology/concurrency lesson, not a Claude/Codex configuration bug.
  Behavioral Go regression tests enforce it; no agent-configuration eval is needed.
