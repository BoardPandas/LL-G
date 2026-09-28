---
tech: rust
tags: [aec3, audio, dsp, buffering, latency, tail-loss, fallback]
severity: high
---
# Equal-length AEC frames can hide fixed delay and discard the recording tail

## PROBLEM

An echo canceller can return one full frame for every input frame while still
holding the newest microphone samples internally. Appending each returned frame
and stopping at the original input length keeps the sample count correct but
records startup history in place of the final audio. Count-only tests pass;
the last sound or syllable can disappear without an error.

For `aec3 0.4.0` with 16 kHz mono, 160-sample frames, high-pass filtering and AEC
enabled, and noise suppression, gain control, and the additional post-filter
disabled, the measured fixed output delay is **128 samples / 8 ms**. The block
framer contributes 64 samples and suppression-window overlap contributes 64.
This is separate from the acoustic render-to-microphone delay estimated by AEC.
Changing acoustic delay or tuning its estimate does not remove this fixed
processing delay. Rebuilding the graph introduces startup delay again.

## WRONG

```rust
for (reference, mic) in paired_frames {
    aec.process_frame(reference, mic, &mut cleaned)?;
    assert_eq!(cleaned.len(), mic.len()); // passes despite the delayed content
    recording.extend_from_slice(&cleaned);
}
assert_eq!(recording.len(), original_len); // the ending can still be missing
// Drop the graph without handling the original mic samples it still holds.
```

Dropping only the startup samples shortens the recording instead. Keeping a
raw fallback copy but emitting it after newer pending microphone samples
reorders the ending. Continuing the old graph after emitting retained originals
can replay the same history a second time.

## RIGHT

Measure the fixed delay for the exact pinned graph and settings. Keep original
microphone samples until their aligned processed replacements arrive. On a
successful, size-checked, finite output frame, the bookkeeping is:

```rust
// startup_remaining = measured_delay at construction and after each reset.
// retained holds originals whose processed replacements have not arrived.
retained.extend(mic_frame.iter().copied());
let skip = startup_remaining.min(cleaned.len());
startup_remaining -= skip;
let aligned = &cleaned[skip..];
output.extend_from_slice(aligned);
retained.drain(..aligned.len());
```

For this graph, the steady-state retained tail is 128 original samples. Keep
the queues bounded independently of recording duration. On stop, unavailable
reference, discontinuity, or processing failure, emit the retained originals
**before** any newer unprocessed microphone samples. This deliberately keeps
that ending unprocessed rather than losing it or inventing silence.

After any raw flush, rebuild/reset the graph before processing later input and
re-arm startup compensation. Otherwise delayed samples already emitted as
originals can escape from the old graph and duplicate recorded history. Keep
the remote reference unchanged; only the microphone output is replaced.

Verify content and timing together:

- Measure alignment against a reference with the **same high-pass filter** and
  AEC bypassed. Comparing against raw microphone samples confounds filter phase
  response with transport delay. Hark's deterministic broadband fixture finds
  the 128-sample peak with correlation above 0.99 against that matched reference.
- Put an isolated impulse in the final input sample. A diagnostic zero-input
  drain exposes the pending processed tail; check its position after startup
  compensation. Repeat after adaptation and reset, with different acoustic
  delays. The diagnostic padding is not additional recorded duration.
- Exercise complete and partial frame endings, reference gaps, processing
  errors, and repeated flush/resume. Assert original length, chronology, and
  one copy of every retained sample, not only finite output or average energy.

## NOTES

- The constant is scoped to this pinned configuration, not all WebRTC/AEC
  implementations, sample rates, or processing chains. Re-measure when changing
  the crate, format, or enabled nodes. The measurement and final-impulse tests
  establish delay/tail behavior, not real-room echo-cancellation quality.
- Upstream [block framing](https://github.com/RubyBit/aec3-rs/blob/f999860f91998daeb6d051e6076eaff629356469/src/audio_processing/aec3/block_framer.rs#L11)
  initializes a block of history; [suppression filtering](https://github.com/RubyBit/aec3-rs/blob/f999860f91998daeb6d051e6076eaff629356469/src/audio_processing/aec3/suppression_filter.rs#L93)
  retains overlap for subsequent output. Source revision
  `f999860f91998daeb6d051e6076eaff629356469` is the packaged `aec3 0.4.0` revision.
- Construct, process, reset, and drop the `!Send` graph on its owning worker;
  keep its allocations out of device callbacks. Treat processing errors as a
  reason to disable or rebuild: this version's [runtime](https://github.com/RubyBit/aec3-rs/blob/f999860f91998daeb6d051e6076eaff629356469/src/graph/runtime.rs#L253)
  temporarily replaces a node with `NoopRunner`, and an early error can skip
  restoration. Retrying the same graph is not proven recovery.
- Related but distinct: [whole-clip resampler startup delay](rubato-4-whole-clip-process-all.md)
  and [LAME final PCM flush](mp3lame-standalone-files-need-final-flush-and-gapless-tag.md).
  Neither supplies streaming AEC retention, fallback ordering, or reset rules.

Hark implementation and regression tests: [meeting_aec.rs](https://github.com/BoardPandas/Hark/blob/e70739070ea233182f80ed9b1e14ddf91932e091/crates/hark-audio/src/meeting_aec.rs),
[echo.rs](https://github.com/BoardPandas/Hark/blob/e70739070ea233182f80ed9b1e14ddf91932e091/crates/hark-pipeline/src/meeting/echo.rs),
[echo_tests.rs](https://github.com/BoardPandas/Hark/blob/e70739070ea233182f80ed9b1e14ddf91932e091/crates/hark-pipeline/src/meeting/echo_tests.rs).
