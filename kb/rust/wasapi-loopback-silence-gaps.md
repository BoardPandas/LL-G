---
tech: rust
tags: [wasapi, cpal, loopback, windows, audio, qpc, timestamps, process-loopback, endpoint-loopback, teams]
severity: high
---
# WASAPI loopback: endpoint loopback sends no packets during silence, and process loopback can be deaf to a non-default endpoint

## PROBLEM
Capturing system audio with endpoint loopback (cpal `build_input_stream` on an output device, or `AUDCLNT_STREAMFLAGS_LOOPBACK` on a render endpoint's `IAudioClient`) delivers ZERO packets while nothing renders -- not silent packets. cpal waits on the event with `INFINITE`, so the callback simply stops, and appending whatever arrives silently compresses the timeline (measured: 0 packets for 16 s, then exactly 8.09 s for an 8 s tone). Every resume raises `DATA_DISCONTINUITY` (cpal: `ErrorKind::Xrun`) even though nothing was lost.

The obvious escape -- per-process loopback (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`), which Microsoft documents as endpoint-independent and which does deliver continuous packets -- is NOT safe to rely on for a call app. Measured on Windows 11 build 26300 (2026-10-14, new Teams): process loopback `IncludeTree(root Teams PID)` read -96.7 dBFS (its idle floor, see process-loopback-idle-not-digital-zero.md) for whole meetings while the call played to the *communications* render endpoint, not the console default; endpoint loopback of that device peaked at -5 dBFS. This is empirical and contradicts the docs, so verify on the target build rather than trusting either. Default render and default communications render are different devices on many real machines (headset vs speakers).

## WRONG
```rust
// 1. Appends only what arrives: silence gaps vanish, tracks drift apart.
device.build_input_stream(cfg, move |data: &[f32], _| producer.push(data), err_fn, None)?;

// 2. "Process loopback is endpoint-independent, so it always hears the call."
let target = LoopbackTarget::ProcessTree { pid: teams_root_pid };
```

## RIGHT
```rust
// Find where the app actually plays: on each ACTIVE render endpoint,
// IAudioSessionManager2::GetSessionEnumerator -> IAudioSessionControl2::GetProcessId,
// matched against the app's process tree (PID-reuse safe: check creation time).
let target = match endpoint_playing(&app_tree) {
    Some(ep) if ep.id != console_default_render_id => LoopbackTarget::Endpoint { id: ep.id },
    _ => LoopbackTarget::ProcessTree { pid: app_root_pid }, // console default: process loopback held up
};

// Endpoint loopback must then pad silence itself. The WASAPI capture timestamp is absolute
// QPC (u64QPCPosition, 100 ns units), shared by every stream in the process.
let due = frames_due_at(qpc_pos, session_t0_qpc, rate);
// Fill idle time with zeros only up to (clock - MARGIN). MARGIN (300 ms) > the 200 ms buffer,
// so a packet still waiting in the buffer can never land on silence already placed.
gaps.fill_until(clock_frames.saturating_sub(MARGIN_FRAMES));
gaps.place(packet, due);
// Report "captured" frames as frames due by the clock, NOT the ring count. A consumer that
// aligns tracks from the ring count turns the 300 ms margin into leading silence on every line.
fn captured_frames(&self) -> u64 { self.frames_due_by_clock() }
```

## NOTES
- The first packet after a silence carries `AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY`. If the gap was padded, nothing was lost: do not count it as an overrun or reset downstream state on it (Hark's echo reducer was reset after every pause until this was skipped).
- cpal ignores `AUDCLNT_BUFFERFLAGS_SILENT`; treat SILENT-flagged buffers as zeros. Compute session t0 from QueryPerformanceCounter scaled the same way.
- Endpoint loopback of a non-default device is opened on that device's own `IAudioClient` (16 kHz mono i16 with `AUTOCONVERTPCM` works); it hears everything playing there, not just the call app.
- Pick the target once at start and log it (endpoint id + friendly name), so a silent recording can be traced to the device choice.
- See also: propvariant-drop-frees-blob.md, process-loopback-idle-not-digital-zero.md, comms-default-mic-is-not-the-call-app-mic.md, silent-capture-track-needs-live-watchdog.md.
