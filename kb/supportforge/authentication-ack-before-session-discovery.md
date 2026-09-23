---
tech: supportforge
tags: [websocket, authentication, go, nodejs, race, technician-session]
severity: high
---
# Authentication acknowledgment must precede session discovery

## PROBLEM
A technician launch can report Connected while every remote command fails. Two independent ordering mistakes cause this:

1. The agent opens its WebSocket and then runs slow system discovery. On a Windows endpoint, collection consumed roughly 12 seconds against the former 10-second pre-authentication window. The server began closing the socket, but a late auth frame could still register a session on it.
2. The server exposes a session in its local map or Redis before sending auth_success. A waiting caller can discover it and enqueue a command before the acknowledgment. A client correctly requiring auth_success as its first application frame then rejects a valid session.

A successful WebSocket upgrade, an auth-frame write, and a session database row are insufficient evidence of usable authenticated transport.

## WRONG
```go
conn := dial()
sendAuth(conn, gatherFullSystemInfo())
setState(Connected) // only proves the write succeeded
```

```typescript
activeSessions.set(id, session);
await publishAttachment(session); // commands may now arrive
sendAuthSuccess(ws, id);
```

## RIGHT
Collect or read cached system information before dialing. Send authentication, then wait for a bounded, well-formed acknowledgment that names the expected session before exposing Connected or starting command dispatch. Keepalive pings must not extend this authentication deadline.

On the server, validate identity and ownership, recheck socket state after awaited work, and queue auth_success before exposing the connection. Do not await between queuing that frame and registering the socket, so its close handler and incoming agent frames see the registration.

```typescript
if (ws.readyState !== WebSocket.OPEN) {
  await retireUnattachedSessionIfStillOwned();
  return;
}
ws.send(JSON.stringify(authSuccess)); // handle write errors by closing/cleaning up
activeSessions.set(id, session);
registerSocket(ws, session);
await publishAttachment(session);
if (ws.readyState !== WebSocket.OPEN || activeSessions.get(id) !== session) {
  await cleanUpOnlyThisAttachment();
}
```

A close handler can finish before an awaited Redis publication completes. Reconcile after publication so late completion cannot leave a dead attachment advertised. Prevent duplicate auth frames from creating concurrent registrations.

## NOTES
- September 23, 2026: SupportForge 3.251.1.0 moved collection before dialing, reused cached telemetry, and extended the old-client window to 30 seconds. Existing desktop 3.250.7.4 then completed remote commands on the affected endpoint. The extension is compatibility support, not a substitute for preparation before dialing.
- Follow-up commit [323d5c84](https://github.com/BoardPandas/supportforge-platform/commit/323d5c84ef1b9951d7965400ff4b0c41c80f4a5e) adds explicit acknowledgment validation and acknowledgment-before-discovery ordering.
- Test real WebSocket peers on the Go side. On the server, exercise close during identity lookup, provider lookup, and Redis publication, including publication completing after close cleanup. Assert acknowledgment ordering directly; assertions thrown inside mocked transport callbacks can be swallowed by production error handlers and falsely pass a test.
- Related: [an active session row is not a live session](active-session-row-is-not-a-live-session.md).
- This is a transport/runtime defect, not an agent-configuration defect. Runtime regressions enforce it; no Claude configuration eval is appropriate.
