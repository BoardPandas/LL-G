---
tech: rust
tags: [wasapi, loopback, process-loopback, audio, silence, testing, windows]
severity: high
---
# WASAPI per-process loopback idles at about -96 dBFS, not digital zero

## PROBLEM
Per-process loopback (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK` with `AUTOCONVERTPCM` to 16 kHz i16) keeps delivering packets while nothing plays. Those packets are not zeros: in the measured case, idle audio was steady 1-LSB noise at about -96.7 dBFS from the format conversion. A silence check such as `all(|s| s == 0)` or `peak == 0.0` therefore never fires, and a "skip silent chunks" rule silently transcribes (and pays for) every idle stretch. Packets flagged `AUDCLNT_BUFFERFLAGS_SILENT` are different: their buffer contents are undefined and must be treated as zeros.

## WRONG
```rust
let silent = chunk.iter().all(|&s| s == 0.0);
if silent { skip(); }
```

## RIGHT
```rust
// Judge by level against a floor, loudest window first, never exact zero.
const DEAD_FLOOR_RMS: f32 = 0.0018; // about -55 dBFS
let silent = peak_window_rms(&chunk, 16_000, 100) < DEAD_FLOOR_RMS;
// And for SILENT-flagged packets, push zeros rather than reading the buffer.
```

## NOTES
Measured on Windows 11 build 26200, exclude mode, with nothing playing: 16 000 frames/s, RMS -96.7 dBFS. Related: wasapi-loopback-silence-gaps.md (endpoint loopback sends no packets at all while silent).
