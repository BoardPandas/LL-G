---
tech: macos
tags: [macos, launchd, launchctl, keepalive, parsing]
severity: high
---
# launchctl print: a KeepAlive dictionary never appears in `properties`

## PROBLEM
For a job whose KeepAlive is a dictionary (for example `{SuccessfulExit=false}`, which some service installers write), `launchctl print system/<label>` never shows `keepalive` on the `properties = ...` line. SuccessfulExit appears only as `successful exit => 0` inside the job's `semaphores = {` block. An idle job with no properties prints `properties = ` with nothing after it. Other KeepAlive keys (Crashed, NetworkState, PathState, OtherJobEnabled) leave the job idle until the condition holds; only SuccessfulExit (which launchd.plist(5) says implies RunAtLoad) means the job starts automatically. Parsers written against reconstructed or guessed output miss both cases and report such services as manual.

## WRONG
```go
automatic := strings.Contains(props, "keepalive") || strings.Contains(props, "runatload")
```

## RIGHT
```go
automatic := strings.Contains(props, "keepalive") || strings.Contains(props, "runatload") ||
    hasTopLevelSemaphore(out, "successful exit") // inside the job's `semaphores = {` block
// Treat an empty `properties = ` line as an empty list, not a parse failure.
```

## NOTES
Capture real `launchctl print system/<label>` output for each plist shape before writing the parser; the format is undocumented. Verified on macOS 27.2.1.
