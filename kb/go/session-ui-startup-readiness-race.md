---
tech: go
tags: [ipc, windows, wails, startup, readiness, timers, lifecycle]
severity: medium
---
# A connected capture host does not mean its session UI is ready

## PROBLEM

A remote-session viewer applies its saved preferences when the capture host
introduces itself. The service starts the separate user-session window at the
same time. A readiness guard correctly refuses directives with no receiving
window, but the default watched-display border reaches that guard before the
window announces ui.ready. Every affected connection starts with an error even
though the window opens moments later. Replaying banner state does not repair
the border: these are independent directives.

The opposite fix, silently dropping the border whenever someone is signed in,
also fails. A signed-in user does not prove the tray or session window will
ever start. No window means no eventual replay and no visible border.

## WRONG

```go
if !windows.has(sessionID) {
    refuse(directive) // Treats "still starting" as a permanent failure.
    return
}
broadcast(directive)
```

## RIGHT

For a cosmetic startup preference, keep one pending latest value per session.
Flush it when the receiving window announces readiness, and bound the wait
with a deadline that reports a real failure if no window arrives. Updating
the preference must replace the pending value without extending the deadline.
Cancel pending work when the session ends or the capture host disconnects;
serialize flushing against a later off-toggle so stale on-values cannot win.
Cap the pending map and remove both the timer and entry on every completion.

Keep security-sensitive controls such as screen blanking and input blocking
on their immediate refusal path. Their failure semantics are separate from
the cosmetic startup preference. A sign-in screen with no user should still
fail immediately, because no user-session window is expected there.

## NOTES

Reproduce with two real IPC clients: send the frame before ui.ready, then
announce readiness and verify the latest toggle reaches the window with no
preceding ui.error. Also test missing-window timeout, no-user refusal, host
teardown, and unchanged privacy-control refusals. Restore the old immediate
refusal in a disposable snapshot and confirm the startup regression fails.

Observed in SupportForge's Go service relay. The viewer's default frame=true
setting made the startup race visible without any user clicking that control.
The fix requires an updated endpoint service; a viewer-only update does not
replace the service's readiness gate.
