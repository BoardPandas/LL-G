---
tech: go
tags: [ipc, named-pipes, go-winio, full-duplex, deadlock, onconnect, readloop, windows, silent-failure, request-response]
severity: high
---
# A client that writes before it starts reading deadlocks a full-duplex pipe, and the reply is lost with nothing logged

## PROBLEM

The natural shape for an IPC client is: dial, tell the caller we connected, then start reading.

```go
conn, _ := dial(addr)
c.conn = conn
if onConnect != nil {
    onConnect(true)   // callers send their handshake here
}
c.readLoop(conn)      // reading starts only after the callback returns
```

This looks correct and survives review, because the callback is "just" sending a greeting. But every `OnConnect` callback in practice sends something immediately, and the server answers immediately, so for the entire duration of the callback the client is **writing to a connection it is not reading**.

On a Windows named pipe (`go-winio`) that deadlocks. Measured directly: with the server's reply sitting unread, the client's *next* write blocked for its whole `SetWriteDeadline` duration and returned `i/o timeout`, and the server's reply was never delivered at all. The same hazard exists on any full-duplex stream once buffers are in play.

Every symptom of this is silent:

- The server's `Send` returns **nil**. It wrote successfully.
- The client's handler **never runs**, so any logging inside it never happens.
- No error is surfaced anywhere, on either side.
- Nothing appears in either log file.

The cruellest property is the trigger. **One send in the callback usually completes before the deadlock can form.** So a handshake-only callback works forever, and the bug appears the day somebody adds a second, entirely reasonable send after it:

```go
onConnect(func(connected bool) {
    sendHandshake(client)        // worked for months
    sendCapabilitiesReport(client)  // <- the day this was added, replies stopped arriving
})
```

Real incident: a desktop agent's tray icon read "Offline" while the agent was online and working normally, submitting tickets and answering the server. The tooltip is driven by a single status message the service sends in response to the tray's handshake, and that reply was being dropped by this deadlock. It was traced by noticing the tray's log had recorded the status message 312 times and then stopped at a specific build, and bisecting to the commit that added a second send to `OnConnect`.

## WRONG

```go
func (c *Client) connectLoop() {
    for {
        conn, err := dial(c.addr)
        if err != nil { /* backoff */ continue }

        c.mu.Lock()
        c.conn = conn
        cb := c.onConnect
        c.mu.Unlock()

        if cb != nil {
            cb(true)     // sends. server replies. nobody is reading.
        }
        c.readLoop(conn) // too late
    }
}
```

## RIGHT

```go
func (c *Client) connectLoop() {
    for {
        conn, err := dial(c.addr)
        if err != nil { /* backoff */ continue }

        c.mu.Lock()
        c.conn = conn
        cb := c.onConnect
        c.mu.Unlock()

        // Reading starts BEFORE the callback, so somebody is always draining
        // the connection. connectLoop keeps its shape by waiting on the loop.
        reading := make(chan struct{})
        go func() {
            defer close(reading)
            c.readLoop(conn)
        }()

        if cb != nil {
            cb(true)   // may now send freely; replies are being consumed
        }
        <-reading
    }
}
```

Handlers can now run concurrently with the callback. That is the point, not a side effect, so handler state must be safe for it (a mutex, or deferring work until the UI is ready).

## NOTES

- **Reproduce it deterministically without the live system**: a test server that replies to the first message, and a client whose `OnConnect` sends **two** messages then returns. One send passes; two hangs. A single-send test will report everything is fine and is why this survives.
- The A/B that identifies it against a running service: send only the handshake (reply arrives, repeatedly) versus handshake plus one more message (reply never arrives, repeatedly). Three runs each way is enough; it is deterministic, not flaky.
- Do not chase the deadline code. `go-winio`'s read and write deadline handlers are per-direction, and the reply is lost immediately rather than at the deadline, so `SetWriteDeadline` is a red herring. The error you see on the second write (`i/o timeout`, or `file has already been closed`) is a consequence, not a cause.
- The generalisation worth carrying: **never let application code write to a connection during a window in which nothing is reading it.** Start the reader first, always, and treat "the callback only sends a greeting" as an assumption that will be broken by someone else later.
- Adjacent design smell in the same incident: the reply being lost was a status flag that was also a hardcoded `true`, sent exactly once. A one-shot state message has no way to correct itself and is wrong in both directions. Broadcast state on change, and report the real thing.
