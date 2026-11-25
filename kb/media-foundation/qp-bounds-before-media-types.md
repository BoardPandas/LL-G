---
tech: media-foundation
tags: [h264, mft, codecapi, qp, rate-control, windows]
severity: high
---
# CODECAPI_AVEncVideoMaxQP/MinQP set after SetOutputType are accepted and ignored

## PROBLEM
The Windows software H.264 encoder MFT answers IsSupported and IsModifiable with S_OK for CODECAPI_AVEncVideoMaxQP and MinQP, and SetValue succeeds mid-stream. The encoder ignores the value: under CBR it still repays one large frame by encoding the next ones at QP 51 under a "maximum" of 26. Nothing errors and a readback returns your value, so the only evidence is the slice QP in the bitstream.

## WRONG
```go
// configure media types, start streaming, then:
codec.SetValue(&CODECAPI_AVEncVideoMaxQP, 26) // S_OK, no effect
```

## RIGHT
```go
// before SetOutputType / SetInputType:
codec.SetValue(&CODECAPI_AVEncVideoMinQP, 20)
codec.SetValue(&CODECAPI_AVEncVideoMaxQP, 30)
mft.SetOutputType(0, h264Type, 0)
mft.SetInputType(0, nv12Type, 0)
```

## NOTES
Same trap as [low-latency mode](low-latency-before-media-types.md). Prove it with a test that parses slice_qp_delta from the output (the parser needs the SPS/PPS from before the window it reads) and fails when the bound is removed.
