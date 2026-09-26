---
tech: rust
tags: [wasapi, cpal, loopback, windows, audio, qpc, timestamps, process-loopback]
severity: high
---
# WASAPI endpoint loopback sends no packets during silence (and may be on the wrong device)

## PROBLEM
Capturing system audio with cpal (`build_input_stream` on an output device = WASAPI loopback) delivers ZERO callbacks while nothing renders -- not silent packets. cpal waits on the event with `INFINITE`, so the callback simply stops, and appending whatever arrives silently compresses the timeline (measured: 0 packets for 16 s, then exactly 8.09 s for an 8 s tone). Every resume also raises `DATA_DISCONTINUITY`, which cpal reports as `ErrorKind::Xrun` -- benign here. Separately, the default render device and the default *communications* render device are often different on real machines, so loopback of the default device can miss a meeting app entirely.

## WRONG
```rust
// Appends only what arrives: silence gaps vanish, tracks drift apart.
device.build_input_stream(cfg, move |data: &[f32], _| producer.push(data), err_fn, None)?;
```

## RIGHT
```rust
// cpal's WASAPI capture timestamp is absolute QPC (u64QPCPosition, 100 ns -> ns),
// shared by every stream in the process: place each packet by its timestamp.
move |data: &[f32], info: &cpal::InputCallbackInfo| {
    let ts = info.timestamp().capture.duration_since(cpal::StreamInstant::ZERO).as_nanos() as u64;
    let due = ((ts - session_t0_ns) as u128 * rate as u128 / 1_000_000_000) as u64;
    if due > frames_placed + rate as u64 / 50 {
        post_gap_event(ring_index, due - frames_placed); // drain inserts zeros here
        frames_placed = due;
    }
    producer.push(data);
    frames_placed += frames;
}
// Better on Win10 2004+: per-process loopback (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK)
// is endpoint-independent, delivers continuous packets through silence, and converts to
// 16 kHz mono i16 itself with AUTOCONVERTPCM (GetMixFormat is unsupported there: pass a format).
```

## NOTES
cpal also ignores `AUDCLNT_BUFFERFLAGS_SILENT`. Compute session t0 from QueryPerformanceCounter scaled the same way (to 100 ns, then ns). Process-loopback exclude mode (everything but your own PID) is endpoint-independent too. See also: propvariant-drop-frees-blob.md.
