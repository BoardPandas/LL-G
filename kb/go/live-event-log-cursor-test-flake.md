---
tech: go
tags: [windows, powershell, eventlogs, testing, ci, fixtures, timestamp-precision]
severity: medium
---
# Live Windows event logs make cursor regression tests flaky and sometimes vacuous

## PROBLEM
A cursor timestamp regression test called the real Windows System event log collector
five times. On GitHub Actions it failed at the production collector's 30-second
subprocess deadline; the same test passed locally in roughly three seconds.
Runner log contents, permissions, query cost and message rendering became inputs to
a test intended to verify millisecond timestamp round-tripping.

An empty or small live log can also pass without proving that a timestamped cursor
advances across multiple pages. A green local rerun does not establish CI reliability.

## WRONG
```go
cursor := Cursor{Channel: "System"}
for page := 0; page < 5; page++ {
    raw, err := collect(context.Background(), cursor) // runner's live event log
    // Decode, round RecordAt to milliseconds, and assert generation is stable.
    // No assertion that there are enough records to exercise pagination.
    _ = raw
    _ = err
}
```

## RIGHT
Run the production PowerShell script and Go subprocess boundary against a test-only
Get-WinEvent function with fixed event records. Keep that function in the test script,
with no production environment variable that can enable it.

Use more records than two pages (401 for a 200-record page) and timestamps with
nonzero sub-millisecond digits. Assert page sizes 200, 200, 1, 0, exact record
continuity, completion state, nonempty generation and nonnil anchors. Round each
acknowledged timestamp to the server's millisecond precision before the next call.
Also assert generation resets for an absent anchor and a reused ID with a different
timestamp. Mutate the production comparison back to full precision and require the
named regression test to fail.

## NOTES
- This covers collector script logic and process integration, not native Windows
  query performance or permissions. Keep any live-provider smoke test separately
  identifiable and deliberately provisioned.
- Keep fixture timestamps away from the rolling time-window boundary. An event
  exactly on the boundary can age out between query construction and execution.
- In Windows PowerShell 5.1, Select-Object -First can put its internal pipeline-stop
  exception into an enclosing advanced function's -ErrorVariable. Use -Wait when
  limiting a small finite fixture so the collector does not mistake it for a read error.
- Observed in SupportForge's TestWindowsEventCursorSurvivesServerPrecision on
  2026-09-08. The replacement passed five repeated runs; the precision mutation
  restarted page two at record 1 rather than 201 and failed as intended.