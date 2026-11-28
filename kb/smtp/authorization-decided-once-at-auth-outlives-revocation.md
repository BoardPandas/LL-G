---
tech: smtp
tags: [submission, auth, revocation, long-lived-session, mail-from, keep-alive, idle-timeout, slowloris]
severity: high
---
# Deciding authorization once at AUTH lets a revoked credential keep sending on an open session, and an idle timer restarted by any byte defeats slowloris protection

## PROBLEM
An SMTP submission session can stay open for a long time and carry many messages. If the server checks the credential only at `AUTH`, then revoking a device credential or an OAuth token stops **new** sessions only: a client (or a thief) that already holds an open session keeps sending for as long as it keeps the connection alive. Any command counts as activity, so refused commands or `NOOP` can hold the session open indefinitely.

A related timer mistake: an idle timeout that restarts whenever **any byte** arrives is no protection against a slow client. One byte just inside each timeout period keeps the connection, and its resources, forever.

## WRONG
```text
AUTH ok        -> session.authorized = true          # decided once
MAIL FROM ...  -> if session.authorized: accept       # never looked at again
(any byte)     -> idle_timer.reset()                  # one byte per period holds the connection
```

## RIGHT
```text
MAIL FROM ...  -> re-check the credential (still valid? not revoked? still allowed this sender?)
before each send to the relay -> re-check again
session        -> hard maximum lifetime, after which the server closes it
refused commands -> counted; past a limit the server closes the connection,
                    so they cannot serve as keep-alives
timers         -> a deadline for a complete command line and for overall DATA progress,
                  not a timer restarted by each byte
```

## NOTES
- The same reasoning applies to any long-lived authenticated connection (IMAP, WebSocket, streaming HTTP): authentication at connect time is not authorization for everything that follows.
- Test: authenticate, revoke the credential out of band, then send `MAIL FROM` on the same session and require a refusal.
