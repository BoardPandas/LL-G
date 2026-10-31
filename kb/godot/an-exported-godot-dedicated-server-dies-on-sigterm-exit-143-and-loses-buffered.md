---
tech: godot
tags: [dedicated-server, sigterm, docker, container, stdout, logging]
severity: high
---
# An exported Godot dedicated server dies on SIGTERM (exit 143) and loses buffered stdout

## PROBLEM
Godot installs no SIGTERM handler, so an exported Linux server is killed outright (exit 143) and its stdout, buffered when redirected to a file or pipe, is discarded.
In a container this means every redeploy kills live game sessions without saving, and the logs that would explain it never appear.

## WRONG
```dockerfile
# Godot is PID 1 and receives SIGTERM directly; no drain, no flushed logs.
ENTRYPOINT ["./server.x86_64"]
```

## RIGHT
```bash
#!/bin/sh
# entrypoint.sh: turn SIGTERM into a drain request the game polls, then wait.
./server.x86_64 &
pid=$!
trap 'touch /tmp/drain' TERM
wait "$pid"; wait "$pid"
```
```ini
; project.godot: flush each print so logs survive a kill
[application]
run/flush_stdout_on_print=true
```

## NOTES
Measured on Godot 4.7.2 dedicated-server export in Debian: `kill -TERM` gave exit 143 and a `print()` line written before the kill never reached the redirected log. Godot's `os_unix.cpp` handles only SIGINT, and only under the debugger. `NOTIFICATION_WM_CLOSE_REQUEST` does not fire from SIGTERM. The second `wait` is needed because the trap interrupts the first.
