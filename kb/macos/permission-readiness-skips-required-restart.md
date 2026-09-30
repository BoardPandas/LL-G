---
tech: macos
tags: [tcc, screen-recording, permissions, state-machines, go]
severity: high
---
# Permission readiness can skip a required restart

## PROBLEM

A permission polling loop returns success as soon as its missing-permission
list becomes empty, before processing a required process restart. If Screen
Recording is the last grant, the restart branch never runs. The remote session
can proceed with a process whose capture connection predates the grant.

The reverse mistake is testing whether Screen Recording was required instead
of whether it was initially missing. That restarts an already-authorized
capture process when only Accessibility is still waiting.

## WRONG

```go
missing = missingServices(required)
if len(missing) == 0 {
    return nil
}
if requiresScreenRecording && !contains(missing, "screen_recording") {
    restart()
}
```

## RIGHT

```go
initiallyMissing := missingServices(required)
// On each poll:
missing := missingServices(required)
if !resumed && contains(initiallyMissing, "screen_recording") &&
    !contains(missing, "screen_recording") {
    if err := restart(); err != nil {
        return []string{"screen_recording"} // still blocked, even when missing is empty
    }
}
if len(missing) == 0 {
    return nil
}
```

## NOTES

Test the final Screen Recording grant, Screen Recording granted before
Accessibility, an Accessibility-only wait, an Accessibility-only completion,
restart failure, cancellation, and the resumed process. Evaluate transition
side effects before terminal readiness. Keep polling/dialog work cancellable.

The regression in SupportForge was established by source inspection and
portable state-transition tests on a native Mac build. This does not replace
signed-app, first-grant ScreenCaptureKit acceptance on the target macOS version.
