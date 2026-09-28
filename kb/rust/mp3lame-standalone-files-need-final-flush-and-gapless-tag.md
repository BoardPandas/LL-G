---
tech: rust
tags: [mp3lame-encoder, lame, mp3, audio, finalization, gapless, data-loss]
severity: high
---
# Standalone LAME MP3 files need a final PCM flush and a gapless tag that fits

## PROBLEM

In `mp3lame-encoder 0.2.5`, `FlushNoGap` calls LAME's
`lame_encode_flush_nogap`: it drains encoded MP3 data for a stream that may
continue in another file. It does not finish encoding the remaining buffered
PCM. Closing a standalone recording after that call can silently lose its last
audio samples, even though encoding succeeds and the MP3 decodes normally.
The name is easy to mistake for the correct way to make a standalone file
play without encoder delay or padding.

`FlushGap` calls `lame_encode_flush`, which completes the PCM tail using padding.
Exact decoded timing also needs the final Xing/Info/LAME tag: a gapless-aware
decoder uses its delay and padding values to trim the encoded frames. Replacing
the flush alone does not guarantee an exact decoded sample count.

With the bundled LAME 3.100 and Hark's 16 kHz mono CBR settings, 32 kbps gives a
144-byte MPEG frame, too small for the tag. LAME silently disables tag writing
when it does not fit. Treating `lame_tag_encode_to_vec` returning `None` as an
optional omission produces a playable export without the timing metadata.
40 kbps gives a 180-byte frame and fits for those settings.

## WRONG

```rust
// "NoGap" is not the final-file PCM flush.
out.reserve(7200);
encoder.flush_to_vec::<FlushNoGap>(&mut out)?;

// Silently accept the missing timing tag, e.g. 16 kHz mono CBR at 32 kbps.
let mut tag = Vec::with_capacity(encoder.lame_tag_size().max(1));
if encoder.lame_tag_encode_to_vec(&mut tag).is_some() {
    let at = encoder.id3v2_tag_size();
    out[at..at + tag.len()].copy_from_slice(&tag);
}
// A duration assertion allowing +/- one second hides a short lost tail.
```

## RIGHT

For a standalone output that promises exact decoded frame counts, choose a
configuration that retains the tag, flush all PCM, require the tag to exist,
and patch the reserved header before writing the finished bytes. Preserve the
separate buffer-capacity requirement before every encode and flush call.

```rust
use mp3lame_encoder::{Bitrate, Encoder, FlushGap};

// For this verified configuration: 16 kHz, one channel, Mode::Mono, CBR.
builder.set_brate(Bitrate::Kbps40)?;

fn finish_file(
    encoder: &mut Encoder,
    out: &mut Vec<u8>,
) -> Result<(), Box<dyn std::error::Error>> {
    out.reserve(7200);
    encoder.flush_to_vec::<FlushGap>(out)?;

    let mut tag = Vec::with_capacity(encoder.lame_tag_size().max(1));
    encoder.lame_tag_encode_to_vec(&mut tag)
        .ok_or("missing gapless timing tag")?;
    let at = encoder.id3v2_tag_size();
    let end = at.checked_add(tag.len()).ok_or("tag offset overflow")?;
    out.get_mut(at..end).ok_or("tag does not fit reserved header")?
        .copy_from_slice(&tag);
    Ok(())
}
```

Round-trip fresh outputs through a gapless-aware decoder and assert the exact
number of frames, including one-sample inputs, MPEG frame boundaries, chunk
boundaries, and partial final chunks. Put non-silent audio only in the final
50 ms and assert that it survives. A successful decode or a generous duration
tolerance does not establish that the tail was encoded.

## NOTES

- Hark's isolated 16 kHz stereo/64 kbps probe compared both flush modes at twelve
  input lengths, from one sample through 960,003 samples. `FlushGap` preserved
  the exact input frame count in all twelve. `FlushNoGap` turned 32,137 frames
  into 30,575 (1,562 frames / 97.625 ms missing), 48,000 into 46,127, and 1,152
  into zero. Very short inputs could instead decode to 576 silent frames;
  this is not a fixed offset that can be repaired by appending a constant pad.
- The regression tests also cover fresh 40 kbps mono full exports and excerpts,
  assert exact decoded lengths, and explicitly reject the missing-tag 32 kbps
  mono configuration. These observations use `mp3lame-encoder 0.2.5`,
  `mp3lame-sys 0.1.11` / LAME 3.100, and Symphonia 0.5.5. The 40 kbps threshold
  is scoped to the verified 16 kHz mono CBR configuration, not every MP3 setup.
- The [Rust flush implementations](https://github.com/DoumanAsh/mp3lame-encoder/blob/16b3e1f4fca851fa14aa9a6c307f6ba2b582aba1/src/input.rs#L236)
  map directly to the two [LAME finalization APIs](https://github.com/DoumanAsh/mp3lame-sys/blob/7a038452d3a1357529ad435485fba909d6001e1a/lame-3.100/include/lame.h#L863).
  LAME's [tag initialization](https://github.com/DoumanAsh/mp3lame-sys/blob/7a038452d3a1357529ad435485fba909d6001e1a/lame-3.100/libmp3lame/VbrTag.c#L526)
  uses the configured CBR bitrate and disables a tag that cannot fit.
- This changes future encodes. Samples never written into a legacy archive
  cannot be reconstructed by changing a decoder, rewriting a tag, or padding
  silence. Preserve existing recordings and distinguish their decoded timeline
  from original-spool ground truth.
- Related: [reserve output capacity before every LAME encode and flush](mp3lame-encode-to-vec-no-reserve.md).
  That memory-safety rule is independent of choosing the correct finalizer.

Hark implementation and regression tests: [mp3.rs](https://github.com/BoardPandas/Hark/blob/7b8bb12660a73e12d52864153a6458234e1c45af/crates/hark-audio/src/mp3.rs),
[excerpt.rs](https://github.com/BoardPandas/Hark/blob/7b8bb12660a73e12d52864153a6458234e1c45af/crates/hark-audio/src/mp3/excerpt.rs).
