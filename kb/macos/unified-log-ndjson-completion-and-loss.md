---
tech: macos
tags: [unified-log, ndjson, monitoring, cursors, go]
severity: high
---
# Unified log NDJSON includes completion and loss records

## PROBLEM

On macOS, `/usr/bin/log show --style ndjson` emits more than ordinary log events. A successful native read can end with a JSON summary such as `{"count":0,"finished":1}`. A parser that requires every line to have an event timestamp rejects a valid empty query. A parser that ignores every non-event line can make a partial or lossy scan look complete and advance a monitoring cursor past missing evidence.

Synthetic fixtures containing only log events hide both mistakes. A subsystem predicate can also filter out loss records before the parser sees them.

## WRONG

```go
for scanner.Scan() {
    var event Event
    _ = json.Unmarshal(scanner.Bytes(), &event)
    if event.EventType != "logEvent" { continue }
    countMatches(event)
}
return Counts{Complete: true} // no evidence that the archive query finished
```

## RIGHT

Treat ordinary events, the completion summary, loss records, and malformed/unknown records separately. Require successful process exit and a recognized completion marker. Mark a window incomplete on loss, parse errors, cancellation, or output truncation. Do not advance its durable cursor or interpret a partial zero count as healthy.

```go
completed := false
for scanner.Scan() {
    record := decodeRecord(scanner.Bytes())
    switch {
    case record.Finished == 1:
        completed = true
    case record.EventType == "logEvent":
        countMatchesWithinRequestedWindow(record)
    default:
        return incompleteWindow()
    }
}
if scanner.Err() != nil || !completed { return incompleteWindow() }
return completeWindow()
```

When filtering a subsystem, retain loss events independently, for example `(eventType == logEvent AND subsystem == "com.example.app") OR eventType == lossEvent`, together with `--loss`.

## NOTES

Observed and regression-tested on a native Mac during SupportForge's macOS monitoring implementation on 2026-09-08. Keep at least one real native provider test as well as NDJSON fixtures. Completion confirms command/parser completion; it does not independently prove that the log archive retained the entire requested historical interval. Numeric Windows event IDs have no direct unified-log equivalent and should report unsupported rather than a healthy zero.
