---
tech: media-foundation
tags: [windows, h264, encoder, icodecapi, low-latency, media-type, buffering, sparse-capture]
severity: high
---
# Enable low-latency mode before negotiating encoder media types

## PROBLEM

The Windows software H.264 MFT accepts CODECAPI_AVLowLatencyMode=true after
SetOutputType/SetInputType and subsequently reads back VT_BOOL TRUE, yet its
already-configured pipeline can still retain multiple input frames. Both
ProcessInput and ProcessOutput return quickly, so timing the calls or measuring
the application's drained output queue falsely suggests low latency.

On Windows Server 2025, a synthetic 1920x1080 trace held eight frames and
reached 8,003 ms input-to-output age when submissions slowed to one per second.
On Windows 11, the same configuration held sixteen frames and reached
12,134 ms over the bounded trace. No network, real desktop capture, input
injection or decoder was involved.

Setting the same low-latency property before either media type eliminated
the retained frames on both machines. The software MFT then returned each
input's output without waiting for another input. Readback was TRUE in both
the broken and corrected configurations.

## WRONG

```go
setOutputType(transform)
setInputType(transform)
codec, err := transform.codecAPI()
if err != nil {
    return err
}
defer codec.release()
if err := codec.setBool(&codecAPILowLatency, true); err != nil {
    return err
}
// A successful SetValue and TRUE readback do not prove the existing
// transform's pipeline was configured without frame-count buffering.
```

## RIGHT

```go
codec, err := transform.codecAPI()
if err != nil {
    return err
}
defer codec.release()
supported, modifiable, err := codec.propertyState(&codecAPILowLatency)
if err == nil && supported && modifiable {
    if err := codec.setBool(&codecAPILowLatency, true); err != nil {
        logLowLatencyUnavailable(err) // preserve the chosen fallback policy
    }
}
// Keep any required D3D manager attached before media-type negotiation.
if err := setOutputType(transform); err != nil {
    return err
}
if err := setInputType(transform); err != nil {
    return err
}
// Apply this initialization order whenever constructing a replacement MFT.
```

## NOTES

- Prove behavior with native output, not only capability/property readback.
  Correlate IMF sample timestamps across input/output to measure internal
  buffering. Several milliseconds in Encode does not establish a fresh frame.
- Include first-frame, sparse-input, forced-keyframe, quality-rebuild and
  geometry-rebuild tests through the production Encode API. A long continuous
  30 fps warmup can conceal the multi-second consequence at sparse cadence.
- A software one-input/one-output assertion is not a universal hardware-MFT
  contract. Retest hardware asynchronously, preserve D3D prerequisites and COM
  ownership, and retain compatibility/fallback behavior.
- Test CBR wall-clock output, SPS/PPS, decode and recording separately. Reducing
  frame buffering does not prove end-to-end input latency or capture cadence.
- Changing worker count after configuration did not fix the observed delay.
  Setting worker count to one before configuration still retained one frame
  on the tested Windows 11 host; prefer the measured low-latency correction.
- Native diagnostic and regression evidence: [SupportForge issue 307](https://github.com/BoardPandas/supportforge-platform/issues/307#issuecomment-6039478512).
- [Microsoft low-latency property documentation](https://learn.microsoft.com/en-us/windows/win32/medfound/codecapi-avlowlatencymode).
