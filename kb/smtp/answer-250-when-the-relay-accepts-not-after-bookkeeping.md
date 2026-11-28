---
tech: smtp
tags: [submission, aws-ses, data, duplicate-email, 250, retry, graceful-shutdown, bookkeeping]
severity: medium
---
# Answering the final dot only after post-send bookkeeping lets a slow store or a shutdown turn an accepted message into a client retry (duplicate)

## PROBLEM
A submission server that relays through Amazon SES receives the message, calls SES, and then records the outcome in its own store before answering the client's final `.`. Once SES has accepted the message, it will be sent. If the bookkeeping is slow, fails, or is interrupted by a shutdown before the `250` goes out, the client sees a timeout or a dropped connection, concludes the message was not accepted, and submits it again. The recipient gets two copies.

## WRONG
```text
DATA ... "."
  ses.send(message)            # accepted: the message WILL be delivered
  store.record_sent(...)       # slow store, or shutdown arrives here
  reply "250 OK"               # never sent -> the client retries -> duplicate
```

## RIGHT
```text
DATA ... "."
  ses.send(message)            # accepted
  reply "250 OK"               # answer as soon as the relay has accepted
  spawn tracked task: store.record_sent(...)    # the shutdown drain waits for this task
```

## NOTES
- The record still has to be written: run it in a task that graceful shutdown waits for, not a detached one.
- Related: `kb/aws-ses/sdk-default-retry-can-double-send-ses-email.md` (the SDK's own retry is the other source of duplicates).
