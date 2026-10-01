---
tech: rust
tags: [symphonia, mp3, gapless, audio, decoding, migration]
severity: high
---
# symphonia 0.6 moved gapless trimming from FormatOptions to the decoder

## PROBLEM
In symphonia 0.5, `FormatOptions { enable_gapless: true }` trimmed the LAME encoder delay
and padding. In 0.6 that field is gone; gapless is `AudioDecoderOptions::gapless`. The
obvious port compiles but loses the trim if you build decoder options any other way:
decoded audio then has leading silence and the wrong length. Other renames in the same
release: `probe::Hint` became `formats::probe::Hint`, `get_probe().format(..)` became
`.probe(..)` returning the reader, `default_track()` takes a `TrackType`, `make` became
`make_audio_decoder` (it takes `codec_params.audio()`), `next_packet()` returns
`Result<Option<Packet>>` (`Ok(None)` is EOF), `packet.track_id` is a field, and
`SampleBuffer` was replaced by `copy_to_vec_interleaved`.

## WRONG
```rust
let fmt_opts = FormatOptions { enable_gapless: true, ..Default::default() }; // 0.5 only
let decoder = get_codecs().make(&track.codec_params, &DecoderOptions::default())?;
```

## RIGHT
```rust
let format = get_probe().probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())?;
let track = format.default_track(TrackType::Audio).ok_or(..)?;
let params = track.codec_params.as_ref().and_then(|p| p.audio()).ok_or(..)?;
let mut decoder = get_codecs()
    .make_audio_decoder(params, &AudioDecoderOptions::default().gapless(true))?;
while let Some(packet) = format.next_packet()? {
    if packet.track_id != track_id { continue; }
    let buf = decoder.decode(&packet)?;
    let mut samples = Vec::<f32>::new();
    buf.copy_to_vec_interleaved(&mut samples);
}
```

## NOTES
Gapless defaults to true in 0.6, but say it explicitly so the intent survives. Pin it
with a test asserting exact decoded frame counts. On 0.5, an `IoError(UnexpectedEof)`
was the EOF signal; keep handling it in 0.6 if truncated files must still decode. Verified
2026-10-01 on symphonia 0.6.1 (Hark 0.61.5).
