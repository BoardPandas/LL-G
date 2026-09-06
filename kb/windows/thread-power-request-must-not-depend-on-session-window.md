---
tech: windows
tags: [remote-desktop, go, ipc, startup-race, power-management, session-isolation]
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
