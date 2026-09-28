---
tech: architecture
tags: [ux, state-machine, timers, grace-period, recording, observability]
severity: medium
---
# A correct grace period looks broken when the user cannot see it

## PROBLEM

An automatic action can be correctly waiting while the UI gives no evidence
that its trigger was recognized. On Hark's first real Teams call, Windows
recorded microphone release immediately, but auto-stop waited 60 seconds.
The user stopped recording manually after 17 seconds and reported auto-stop
as broken: the pending state looked identical to an ongoing call.

## WRONG

```text
call releases microphone -> silently wait 60 seconds -> stop
UI stays indistinguishable from an ongoing call
```

## RIGHT

```text
call releases microphone -> publish pending-stop deadline
show when recording will stop and provide Stop now
microphone use resumes -> cancel pending stop and clear its notice
deadline passes -> stop
```

## NOTES

Hark changed its default to 15 seconds after this observation; that duration
is a product choice, not a universal recommendation. The reusable lesson is
to expose pending state and cancellation from the underlying state machine,
rather than running an unrelated UI timer that can drift from the action.

Evidence: [detector pending-stop state](https://github.com/BoardPandas/Hark/blob/9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654/crates/hark-meeting/src/detect.rs),
[visible deadline and Stop now](https://github.com/BoardPandas/Hark/blob/9a61d11d06056d6b54b9ad6f4cd8c4fb1f2fe654/crates/hark-app/src/ui/meetings/mod.rs),
and the first-real-call observations in the meeting plan, section 8.
