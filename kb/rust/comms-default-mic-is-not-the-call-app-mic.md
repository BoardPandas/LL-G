---
tech: rust
tags: [wasapi, core-audio, microphone, capture, teams, meetings, windows, audio-sessions]
severity: high
---
# The Windows communications-default mic is not "the mic the call app uses"

## PROBLEM
A meeting recorder that opens the default *communications* capture endpoint (`eCommunications`), assuming that is where Teams (or Zoom, or a browser call) captures from, records the wrong microphone with no error. Call apps have their own device setting that overrides the Windows defaults. Measured 2026-10-14 (Windows 11 build 26300, new Teams): six meetings over a week recorded a muted communications-default headset mic while Teams used a different USB mic. The stream opened, packets flowed, levels sat at the floor -- every API call succeeded.

## WRONG
```rust
// "Calls use the communications device, so that's the meeting mic."
let mic = enumerator.GetDefaultAudioEndpoint(eCapture, eCommunications)?;
```

## RIGHT
```rust
// Ask Core Audio which capture endpoint the call app is actually recording from:
// on each ACTIVE capture endpoint, IAudioSessionManager2::GetSessionEnumerator,
// keep sessions whose IAudioSessionControl2::GetProcessId is in the app's process tree
// and whose state is AudioSessionStateActive.
let mic = user_override                          // explicit setting wins
    .or_else(|| capture_endpoint_of(&app_tree))  // where the call app records
    .unwrap_or(comms_default_capture);           // last resort only
log::info!("meeting mic: {} ({})", mic.friendly_name, mic.id);
```

## NOTES
- Match the whole process tree, not one PID: new Teams (ms-teams.exe) does its audio from child processes. Check process creation time so a recycled PID is not matched.
- A call app may hold sessions on several endpoints; prefer the one in AudioSessionStateActive.
- The render side has the same trap: see wasapi-loopback-silence-gaps.md.
- Pair with a live level watchdog (silent-capture-track-needs-live-watchdog.md): a wrong-device choice is otherwise invisible until someone opens the recording.
