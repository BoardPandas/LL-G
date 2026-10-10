---
tech: ffmpeg
tags: [ffmpeg, video, timestamps, variable-frame-rate, decode, validation]
severity: high
---
# Passthrough frame timing does not preserve the output time base

## PROBLEM

A full-file decode check can report non-monotonic output DTS even when the
recorded presentation timestamps are distinct and increasing. With variable-rate
desktop capture, `-fps_mode passthrough` does not by itself preserve the encoder's
time base. FFmpeg's default output encoder time base is the inverse frame rate.
Distinct timestamps can round onto the same tick before reaching the null muxer.

This is easy to misdiagnose as a corrupt recording or capture/transport clock
bug. The process can also exit zero while printing an error diagnostic, so exit
code alone is insufficient for strict evidence verification.

## WRONG

```sh
# Passthrough frame handling does not select the output encoder's time base.
ffmpeg -nostdin -v error -xerror -i capture.mp4 \
  -map 0:v:0 -an -sn -dn -fps_mode passthrough -f null -

# Do not discard stderr or use -r, clipping, timestamp rewriting or frame
# dropping merely to make this verification command succeed.
```

## RIGHT

```sh
# Select the source demuxer clock for the output as well as passthrough timing.
ffmpeg -nostdin -v error -xerror -i capture.mp4 \
  -map 0:v:0 -an -sn -dn -enc_time_base demux \
  -fps_mode passthrough -f null -
```

For a strict recording checker, retain stderr and the actual child-process exit
result. Decode every frame and independently probe the source timestamps, frame
count, dimensions, gaps and complete required interval. Reject actual duplicate
or reset source timestamps, truncated recordings and decoder errors. An output
clock correction is not permission to weaken those checks.

## NOTES

- Verified on Windows with FFmpeg 9.0.2 against an unchanged, hash-pinned H.264
  MP4 with a `1/90000` source time base. Eleven strictly increasing frame PTS
  included `0.093956` and `0.107967`; their short separation collided on the
  coarser default output clock. The old command exited zero with 357 bytes of
  DTS diagnostics. Adding only `-enc_time_base demux` exited zero with empty
  stderr using the same file and decoder binary.
- The recording was still an incomplete failed test. Successful decoding did
  not make its duration, OCR, live latency or native product acceptance pass.
- FFmpeg's [official output time-base documentation](https://ffmpeg.org/ffmpeg.html#Advanced-options)
  distinguishes default `0` (inverse frame rate for video) from `demux`.
  `-copyts` is not a substitute for selecting the output encoder time base.
- Reproduction and regression are tracked in
  [SupportForge issue 307](https://github.com/BoardPandas/supportforge-platform/issues/307).
  The repository's `recording-check.test.mjs` asserts the output flag, retains
  distinct variable-rate timestamps and rejects genuine duplicate timestamps.
- The command snippets show the timing fix only. Production validation must
  also pin the executable and input, bound resource use, restrict allowed input
  protocols/demuxers and retain cleanup evidence. Do not execute arbitrary media
  tools or broaden external-track access to investigate a warning.
