---
tech: go
tags: [websocket, authentication, deadlines, gorilla, lifecycle, windows]
severity: high
---
# Collect slow metadata before opening an authenticated WebSocket

## PROBLEM

A client opens a WebSocket and then collects operating-system inventory before
sending its authentication frame. The server starts its authentication deadline
at connection time, so inventory collection silently spends that deadline. Fast
machines work; slower machines can time out before their first frame. Increasing
the client's read timeout cannot extend the server's authentication deadline.

If the server also accepts late authentication on a closing socket, it can
publish a session owner for a connection that can no longer carry commands.
The connect operation reports success while every subsequent command fails.

## WRONG

```go
conn, _, err := dialer.Dial(endpoint, nil)
if err != nil {
    return err
}
info := collectSystemInfo() // May take longer than the server's auth window.
return conn.WriteJSON(Auth{Token: token, SystemInfo: info})
```

## RIGHT

```go
info := collectSystemInfo()
conn, _, err := dialer.Dial(endpoint, nil)
if err != nil {
    return err
}
if err := conn.WriteJSON(Auth{Token: token, SystemInfo: info}); err != nil {
    conn.Close()
    return err
}
return nil
```

The server must also reject authentication from a closing or closed socket and
recheck liveness after asynchronous ownership/configuration lookups, before
registering the connection. Publication and cleanup need explicit lifetime
coordination if a shared registry write can race disconnect; checking once at
the start does not protect later awaits.

## NOTES

- A regression test can block the metadata collector, assert that no connection
  reaches the test server, then release collection and verify the auth frame.
  This proves the ordering without a slow native WMI call or real credentials.
- Server negative tests should cover both already-closed sockets and closure
  while an asynchronous authentication lookup is pending, asserting no session
  or owner record is published. Retain a successful live-socket control.
- This ordering fix does not bound collection itself. Keep independent limits
  for inventory work, connection startup and the already-minted token lifetime.
- Local regressions reproduced both defects. Endpoint logs with roughly twelve
  seconds between socket open and session registration supported investigating
  this path, but an installed-binary measurement is still needed to prove the
  exact cause on a particular machine.
