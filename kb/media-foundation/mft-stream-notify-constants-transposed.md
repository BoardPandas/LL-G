---
tech: media-foundation
tags: [mft, imftransform, async-mft, processmessage, metransformneedinput, h264, encoder, video, com, windows]
severity: high
---
# MFT_MESSAGE_NOTIFY_END_OF_STREAM comes before START_OF_STREAM in the enum, and transposing them silently stalls every async MFT

## PROBLEM

`MFT_MESSAGE_TYPE` orders its two stream notifications the opposite way round
from how anyone says them out loud:

```
MFT_MESSAGE_NOTIFY_BEGIN_STREAMING   = 0x10000000
MFT_MESSAGE_NOTIFY_END_STREAMING     = 0x10000001
MFT_MESSAGE_NOTIFY_END_OF_STREAM     = 0x10000002   <- END is 2
MFT_MESSAGE_NOTIFY_START_OF_STREAM   = 0x10000003   <- START is 3
```

Hand-transcribing the enum (any language without the SDK headers -- Go, Rust,
C#, Python, or C with the values inlined) you write START before END because
that is the order they happen in, and you assign `0x10000002` to START. Nothing
checks you.

What makes this expensive is the failure shape:

- A **synchronous** MFT ignores both notifications entirely -- it is driven by
  `ProcessInput` / `ProcessOutput` directly -- so it keeps working perfectly.
  Your software fallback is fine, which is the strongest possible signal that
  the bug is not in your code.
- An **asynchronous** MFT (what a hardware encoder generally is) has just been
  told, immediately after `NOTIFY_BEGIN_STREAMING`, that the stream has *ended*.
  It therefore never queues a single `METransformNeedInput`, and `ProcessInput`
  returns `MF_E_NOTACCEPTING` (0xC00D36B5) forever.

Every diagnostic you reach for comes back clean: `MF_TRANSFORM_ASYNC` reads 1,
setting `MF_TRANSFORM_ASYNC_UNLOCK` returns `S_OK`, the transform is genuinely
unlocked (`SetOutputType` returns `S_OK` rather than
`MF_E_TRANSFORM_ASYNC_LOCKED`), `QueryInterface` for
`IMFMediaEventGenerator` succeeds, and both media types are accepted. The MFT
configures cleanly and then produces nothing, with no error anywhere -- which
reads as a vendor driver quirk, not as a wrong constant. It reproduced
identically on NVIDIA's and Microsoft's DX12 H.264 encoders, which made the
"vendor bug" reading even more convincing.

## WRONG

```go
// Transcribed in the order the events occur, which is not the order the enum
// declares them. Nothing fails to compile, and the software MFT still works.
const (
    mftMessageNotifyBeginStreaming = 0x10000000
    mftMessageNotifyEndStreaming   = 0x10000001
    mftMessageNotifyStartOfStream  = 0x10000002 // actually END_OF_STREAM
    mftMessageNotifyEndOfStream    = 0x10000003 // actually START_OF_STREAM
)

transform.processMessage(mftMessageNotifyBeginStreaming, 0)
transform.processMessage(mftMessageNotifyStartOfStream, 0) // says "end of stream"

// Async MFT: GetEvent(MF_EVENT_FLAG_NO_WAIT) returns MF_E_NO_EVENTS forever,
// ProcessInput returns MF_E_NOTACCEPTING, zero samples, zero errors.
```

## RIGHT

```go
// END_OF_STREAM is 0x10000002 and START_OF_STREAM is 0x10000003. Worth a
// comment at the definition, because the next reader will also expect the
// other order.
const (
    mftMessageNotifyBeginStreaming = 0x10000000
    mftMessageNotifyEndStreaming   = 0x10000001
    mftMessageNotifyEndOfStream    = 0x10000002
    mftMessageNotifyStartOfStream  = 0x10000003
)

transform.processMessage(mftMessageNotifyBeginStreaming, 0)
transform.processMessage(mftMessageNotifyStartOfStream, 0)

// METransformNeedInput (601) now arrives, and the async drive loop works:
// pump events, ProcessInput on NeedInput, ProcessOutput on HaveOutput (602).
```

## NOTES

- Fastest confirmation that it is this and not the driver: **if your
  synchronous/software MFT works and your asynchronous/hardware one accepts
  every media type but never queues `METransformNeedInput`, check these two
  constants before anything else.** The asymmetry is the tell -- a real driver
  problem would not spare the software path.
- Same trap applies to the values around them. `MFT_MESSAGE_COMMAND_FLUSH` = 0,
  `MFT_MESSAGE_COMMAND_DRAIN` = 1, and `MFT_MESSAGE_SET_D3D_MANAGER` = 2 are a
  separate low-numbered group; `SET_D3D_MANAGER` being 2 is easy to confuse
  with `NOTIFY_END_OF_STREAM` at 0x10000002 when skimming.
- On teardown, do not send `NOTIFY_END_OF_STREAM` and then immediately release:
  that asks an async MFT to *drain*, i.e. to start real work on its own threads,
  at the moment you drop its last reference. Either drain properly (send
  END_OF_STREAM + `COMMAND_DRAIN`, then pump until
  `METransformDrainComplete` = 603) or send `COMMAND_FLUSH` and skip the drain.
- Related: hardware MFTs also need a Direct3D device before they will negotiate
  a media type at all -- see `hardware-mft-needs-d3d-manager.md`.
