---
tech: rust
tags: [audio, capture, silence, watchdog, recording, meetings, ux, observability]
severity: high
---
# A silently empty capture track must be loud in the UI: run a live level watchdog with a floor

## PROBLEM
A recording that captures the wrong device, a muted mic, or a deaf loopback still "works": the stream opens, packets arrive, files are written, and the transcription provider returns nothing -- which reads as a provider or network fault. Measured in Hark (2026-10-14): six meetings over a week recorded only silence and the only trace was an INFO log line. Checking for exact digital zero does not catch it either: WASAPI process loopback idles at about -96.7 dBFS and a muted mic delivers low noise, so `== 0.0` never fires.

## WRONG
```rust
// Detects only true digital silence, and only after the fact.
if samples.iter().all(|&s| s == 0) { log::info!("track was silent"); }
```

## RIGHT
```rust
// Judge each placed batch by its loudest 100 ms window against a floor above the idle noise.
const FLOOR_RMS: f32 = 5.6e-5; // about -85 dBFS: above the -96.7 dBFS loopback idle floor
if peak_window_rms(&batch, rate, 100) >= FLOOR_RMS { track.last_heard = now; }
if now - track.last_heard >= Duration::from_secs(45) && !track.noticed {
    track.noticed = true; // notify once per track, not every batch
    ui.notify(format!("No sound from {} for 45 s. Check the mic in your call app.", track.device_name));
}
```

## NOTES
- Name the device in the notice; "no audio" without a device name sends the user to the wrong setting.
- Run one watchdog per track (Me / Them). A silent Them is normal while only the user talks, so its timeout and wording differ.
- The floor here (-85 dBFS) answers "is anything there at all"; a speech gate needs a much higher floor (see process-loopback-idle-not-digital-zero.md, mean-rms-gate-length-dependent.md).
- When a provider "returns nothing", check the audio you sent before blaming the provider or the network.
