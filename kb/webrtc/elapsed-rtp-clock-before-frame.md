---
tech: webrtc
tags: [pion, rtp, timestamps, duration, jitter, remb, bandwidth, remote-desktop, sparse-video]
severity: high
---
# Apply elapsed RTP time before packetizing the current frame

## PROBLEM

In Pion WebRTC 4.2.20, `TrackLocalStaticSample.WriteSample` converts
`Sample.Duration` into clock ticks and passes them to RTP 1.10.5's packetizer.
The packetizer stamps the current frame with its existing timestamp, then
advances that timestamp by the supplied duration.

That is easy to misunderstand when a live screen sender measures elapsed time
since its previous output. That interval belongs BEFORE the current frame.
Passing it directly as Duration shifts every measured gap one frame late.
At a constant frame rate this is largely invisible. At idle/burst transitions,
a one-second pause can be stamped as 33 ms, followed by a 33 ms frame stamped
as a one-second gap.

The receiver can interpret the discrepancy as delay variation/congestion.
Connection health and zero packet loss do not expose this source-side clock
error. In a real Chromium synthetic loopback comparison with identical H.264
data and cadence, old timing reported 160 ms jitter, 13 dropped frames and
about 60 ms average jitter-buffer delay; corrected timing reported 0 ms,
one dropped frame and under 1 ms. The old REMB estimate declined while the
corrected estimate recovered. These are bounded transport measurements, not
a universal quality guarantee or native capture acceptance.

## WRONG

```go
elapsed := now.Sub(previousOutputAt)
previousOutputAt = now

// elapsed describes the gap before this frame, but Pion applies it after.
return track.WriteSample(media.Sample{Data: encodedFrame, Duration: elapsed})
```

A test asserting only that `elapsed == oneSecond` cannot catch the defect.
Inspect the RTP timestamp on the actual emitted packet.

## RIGHT

```go
// One serialized producer owns this pair of writes for the shared track.
func writeCurrentFrame(
    track *webrtc.TrackLocalStaticSample,
    encodedFrame []byte,
    elapsed time.Duration,
) error {
    // Empty payload advances Pion's RTP clock without emitting an RTP packet
    // or consuming a packet sequence number.
    if err := track.WriteSample(media.Sample{Duration: elapsed}); err != nil {
        return err
    }
    return track.WriteSample(media.Sample{Data: encodedFrame})
}
```

For a different media library or upgraded Pion version, verify its packetizer
semantics first. Do not assume setting `Sample.Timestamp` or
`Sample.PacketTimestamp` fixes this: this Pion WriteSample implementation
does not consume either field.

## NOTES

- Serialize the advance-and-write pair. Independent concurrent writers could
  interleave the two calls. One capture/encoder producer can still fan the same
  track out to multiple viewer bindings.
- Preserve the real elapsed interval, including long pauses; a cap or a nominal
  encoder frame period makes the media clock diverge from wall time again.
- Do not add dummy pictures, replay frames, an extra capture ticker, or a higher
  bitrate floor to hide clock errors. The empty sample emits no network packet.
- Keep recorder timing separate. This correction concerns when the RTP clock
  advances, not the recorded duration or the encoder's CBR configuration.
- Test sparse-to-burst transitions, fractional ticks, timestamp/sequence wrap,
  fragmented frames, late joins and a failed viewer alongside a healthy one.
- Initial browser measurements were retained but not called passing when their
  test-process cleanup failed. The repeated, gracefully closed run is the
  verified comparison.
- Source and retained evidence: [SupportForge fix](https://github.com/BoardPandas/supportforge-platform/commit/661c8bd76bb16e998f2de01d09ccf16c80b4dd3b),
  [packet regressions](https://github.com/BoardPandas/supportforge-platform/blob/661c8bd76bb16e998f2de01d09ccf16c80b4dd3b/desktop_agent_v2/internal/remotecontrol/video_track_sample_test.go),
  [browser comparison](https://github.com/BoardPandas/supportforge-platform/blob/661c8bd76bb16e998f2de01d09ccf16c80b4dd3b/tasks/evidence/2026-10-07-video-quality/browser-clock-comparison.json).
- Library sources: [Pion WriteSample](https://github.com/pion/webrtc/blob/v4.2.20/track_local_static.go),
  [RTP Packetize](https://github.com/pion/rtp/blob/v1.10.5/packetizer.go).
