---
tech: windows
tags: [remote-desktop, go, ipc, startup-race, power-management, session-isolation, optional-workers, hotkeys, rust]
severity: high
---
# A thread-owned power request must not depend on a user-session window

## PROBLEM

A remote-desktop viewer sends its saved keep-awake preference immediately on
connection. Routing that request through a consent window makes it race the
window's startup and fail permanently at the Windows sign-in screen. A relay
that equates "no window has announced itself" with "nobody is signed in"
then reports a false explanation on every connection, even when a user is
present. Sending `on: false` can trigger the same warning.

The architectural mistake is treating every desktop-related action as a
per-user UI operation. Windows SetThreadExecutionState is a power request
owned by its calling thread. It needs no consent window or logged-in user.
Wallpaper, screen blanking, and clipboard access have different requirements.

## WRONG

```go
// Every desktop directive goes through a UI-ready gate.
if !windows.has(sessionID) {
    return errors.New("nobody is signed in")
}
relayToConsent("desktop.idletimeout", state)
```

Silencing that rejection or delaying the request does not implement keep-awake
at the sign-in screen. Replaying it only when a window arrives still leaves
sessions with no window unsupported.

## RIGHT

```go
// In the Windows capture host's presence adapter:
if kind == PresenceIdleTimeout {
    return hostPower.Apply(kind, state.On)
}
return relayToUserSession(kind, payload)
```

Use a dedicated locked OS thread for SetThreadExecutionState. Apply
ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED to hold awake and
ES_CONTINUOUS alone to release. Serialize requests with session teardown,
restore before closing the backend, and propagate actual OS failures. A
per-session host process also releases its request when the process dies.
Keep genuine UI operations on the user-session path and describe a missing
window as unavailable, without inventing the user's sign-in state.

## NOTES

- Reproduce through the real host constructor with no IPC connection or
  consent window. Cover false, true, false, true, malformed input, and teardown.
- Verify a privacy operation still refuses without its user-session window.
- Keep a fake-backend test for error propagation and close-once behavior.
- SupportForge's regression failed on the initial false directive before the
  fix and passed through its existing Windows desktopstate backend afterwards.
- Microsoft: https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate

### The same dependency mistake with an optional worker

A shared input source also must not belong to one optional command consumer.
Hark's meeting shortcut needs the global keyboard hook even when dictation cannot
start because its provider key or microphone is unavailable. Starting the hook
inside dictation startup accidentally makes that unrelated prerequisite disable
meeting commands too.

```text
WRONG: start dictation worker -> worker owns hook -> route every command there
RIGHT: app owns one hook -> dispatch by command -> independent consumers
       absent dictation consumer does not disable the meeting command lane
```

Keep lifecycle ownership at the shared source: stop the native listener, let the
router close its worker input, then wait for worker teardown. Do not let an
unrelated command lane retain the sender needed to stop another worker. See
[sender ownership and join ordering](../rust/join-on-drop-sender-field-order.md).
For a hook that can suppress keys, disable that suppression when its owning
operation did not start; the independent meeting action remains observe-only.

Exercise routing with the optional worker absent and with its input undrained.
Assert that independent commands still arrive and teardown disconnects input.
These seams cover the ownership defect; they do not substitute for real native
keyboard testing. Hark added these cases during its September 2026 meeting Polish
work. The existing no-consent-window power-request case above remains the same
rule applied to a different optional component.

Hark source and regression tests: [pipeline.rs](https://github.com/BoardPandas/Hark/blob/287df97edbd405442308c2ddd79700ff839d58fc/crates/hark-app/src/pipeline.rs),
[shortcuts.rs](https://github.com/BoardPandas/Hark/blob/287df97edbd405442308c2ddd79700ff839d58fc/crates/hark-hotkey/src/shortcuts.rs).
