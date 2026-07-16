---
tech: rust
tags: [rubato, audio, resampling, dsp, api-churn, fft, audioadapter]
severity: high
---
# rubato 4.0 removed the FftFixed/SincFixed types; whole-clip resampling must use process_all

## PROBLEM
rubato 4.0.0 (released 2026-07-09) restructured the entire resampler API. The long-documented `FftFixedIn` / `FftFixedInOut` / `SincFixedIn` / `FastFixedIn` types are gone, replaced by two consolidated types (`Fft` for synchronous fixed-ratio, `Async` for variable-ratio) plus the `audioadapter` buffer abstraction: inputs are `&dyn Adapter<T>` (wrap a plain mono slice with `InterleavedSlice::new(buf, channels, frames)`), and outputs come back as `InterleavedOwned<T>`.

Worse than the compile errors is the silent trap that survives the migration: resampling a complete in-memory clip with a single `process()` call (by constructing the resampler with `chunk_size` set to the clip length) LOOKS correct but leaves the FFT startup delay in the output. The clip comes back with leading silence and a truncated tail, which downstream consumers (e.g. speech-to-text) experience as clipped first words and missing endings, with no error anywhere.

The crate is also churning fast: 1.0.0 (2025-12-30) to 4.0.0 (2026-07-09) is three major versions in under 8 months. Any cached knowledge or old example code is likely wrong.

## WRONG
```rust
use rubato::{FftFixedIn, Resampler}; // E0432: no longer exists in rubato 4.x

// ...and even after renaming, the whole-clip-via-one-process() pattern is
// silently wrong: startup delay untrimmed, output misaligned.
let mut r = Fft::<f32>::new(48_000, 16_000, samples.len(), 1, FixedSync::Both)?;
let out = r.process(&input, None)?; // leading silence + truncated tail
```

## RIGHT
```rust
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};

let mut r = Fft::<f32>::new(48_000, 16_000, 1024, 1, FixedSync::Both)?;
let input = InterleavedSlice::new(samples, 1, samples.len())?;
// process_all resets the resampler, chunks internally, trims the FFT
// startup delay, and returns exactly ceil(input_len * ratio) frames.
let output = r.process_all(&input, samples.len(), None)?;
let mono: Vec<f32> = output.take_data(); // 1 channel: data vec IS the clip
```

## NOTES
- Output length contract is `ceil(input_len * ratio)`, NOT `round`. Unit tests asserting exact counts must use ceil (48 000 samples at 3:1 -> exactly 16 000; 240 -> 80).
- `process_all` handles clips shorter than one internal chunk (short push-to-talk utterances) without panicking.
- Guard the delay-trim behavior with a head-signal test: resample a pure tone and assert the first ~10 ms of output has non-trivial RMS. If the head is silent, the startup delay leaked through.
- `Fft::new(rate_in, rate_out, chunk_size, nbr_channels, FixedSync::Both)` returns `Result`; the old `sub_chunks` constructor parameter is gone (auto-calculated, ~256-frame sub-chunks).
- `fft_resampler` is a default cargo feature; no feature flags needed for `Fft`.
- Given the major-version cadence, re-verify this API at every rubato bump. Verified hands-on 2026-07-16 in Hark's `hark-audio` crate (exact 3:1, non-integer 44.1k->16k, sub-chunk clips all tested).
