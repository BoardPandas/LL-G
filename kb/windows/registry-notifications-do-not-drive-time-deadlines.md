---
tech: windows
tags: [registry, notifications, debounce, deadlines, state-machine, shutdown, rust]
severity: high
---
# Registry notifications do not drive debounce or grace-period deadlines

## PROBLEM

Replacing a polling loop with `RegNotifyChangeKeyValue` can silently stop a
state machine from advancing. A microphone-open write starts a five-second
debounce; a microphone-close write starts an auto-stop grace period. Neither
requires another registry write when time expires. Evaluating the detector only
after notifications leaves it waiting indefinitely, or until an unrelated write.

A periodic safety poll conceals the defect while making the actual action wait
for that poll. A cached snapshot is also insufficient at the deadline: the
microphone may have reopened, or the original trigger may have disappeared.

## WRONG

```text
wait indefinitely for registry change
read snapshot
detector.observe(snapshot, now)
# The detector remembers a future deadline, but nobody schedules it.
```

## RIGHT

```text
wait for the earliest of:
  a command or coalesced registry notification
  the detector's next debounce/auto-stop deadline
  a safety poll (also covers state outside the registry)
  the capture-drain deadline, while recording

if a registry notification, detector deadline, or safety poll fired:
  read a FRESH snapshot
  detector.observe(snapshot, monotonic_now)
```

The detector owns its deadlines and cancels them when the source changes. Repeated
notifications must not restart an already-running debounce. On a registry event,
rearm the registration before enqueueing the request for a snapshot; coalesce
queued requests rather than accumulating one per registry value write. A failed
watcher should leave bounded polling available and allow a later watch retry.

## NOTES

- `RegNotifyChangeKeyValue` observes changes, not passage of time. Each completed
  notification requires a new registration. Use a persistent registration thread,
  or the appropriate thread-agnostic flag, and keep the key/event handles alive.
  See [Microsoft's API reference](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regnotifychangekeyvalue).
- If the watcher owns a sender into the coordinator, dropping only the UI's
  sender cannot terminate the coordinator's receive loop. Send an explicit
  shutdown command, stop the watcher, and then close capture. This is an instance
  of the existing [sender ownership and join lesson](../rust/join-on-drop-sender-field-order.md),
  not a separate shutdown rule.
- Regression cases: one open notification reaches the debounce deadline with no
  further writes; the trigger ends before that deadline; one close notification
  reaches auto-stop; a fresh deadline snapshot sees the microphone reopened;
  shutdown completes while a watcher still holds a sender. Test the detector with
  supplied monotonic times instead of sleeping.
- Hark's Polish implementation exercises those schedules and separately tests
  registry rearming against an isolated test key. Source/test review does not
  establish behavior with a real meeting application's ConsentStore writes.
- Exposing the pending deadline in the UI remains the separate
  [grace-period visibility lesson](../architecture/invisible-grace-period-looks-broken.md).

Hark source and regression tests: [probe_watch_win.rs](https://github.com/BoardPandas/Hark/blob/713434de160738dd6b8c3fe91ca392bc86949ee5/crates/hark-meeting/src/probe_watch_win.rs),
[detect.rs](https://github.com/BoardPandas/Hark/blob/713434de160738dd6b8c3fe91ca392bc86949ee5/crates/hark-meeting/src/detect.rs),
[coordinator.rs](https://github.com/BoardPandas/Hark/blob/713434de160738dd6b8c3fe91ca392bc86949ee5/crates/hark-pipeline/src/meeting/coordinator.rs).
