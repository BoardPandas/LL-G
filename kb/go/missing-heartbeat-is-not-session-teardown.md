---
tech: go
tags: [macos, ipc, session-lifecycle, teardown, regression-tests]
severity: high
---
# A missing heartbeat entry does not prove a session was torn down

## PROBLEM
A process-exit handler rejects terminal viewer-left/no-viewer reports unless a
local heartbeat registry contains the session. Direct launches bypass the consent
answer that populates that registry, so the tray correctly reports the exit but
the service silently skips teardown. The capture process is gone while its
connected-session banner remains visible. Tests that always start a heartbeat
hide the failure.

## WRONG
```go
if !agent.remoteSessionIsLive(sessionID) {
    return // assumes absence from one optional registry means already ended
}
agent.endRemoteSessionLocallyAndUpstream(sessionID)
```

## RIGHT
```go
_, hasHost := sessionUIHosts.get(sessionID)
_, hasPrompt := presentedPrompts.peek(sessionID)
if !agent.remoteSessionIsLive(sessionID) && !hasHost && !hasPrompt {
    return
}
agent.endRemoteSessionLocallyAndUpstream(sessionID)
```

## NOTES
Only terminal exit codes take this path. Preserve handoff and recoverable exits.
Teardown broadcasts the end before clearing the prompt, host, UI and heartbeat
records; repeated reports then find no owned state. A larger lifecycle redesign
can unify the registry, but absence from an optional background task is not a
substitute for ownership evidence.

Observed in SupportForge on macOS: the host logged viewer_left and the tray logged
a delivered exit code 64, while the service only restored desktop state. Tests
must cover host-only and prompt-only ownership without a heartbeat, observe the
actual IPC end broadcast, check cleanup, and replay the exit to check deduplication.
Keep pure lifecycle tests untagged so all platforms execute them. No agent-config
evaluation is needed; this is a runtime lifecycle bug with Go regression coverage.
