---
tech: media-foundation
tags: [mf-mt-max-keyframe-spacing, h264, keyframe, idr, gop, screen-capture, variable-frame-rate, imftransform, black-video]
severity: high
---
# MF_MT_MAX_KEYFRAME_SPACING counts submitted frames, so "two seconds" becomes a minute on a still screen

## PROBLEM

`MF_MT_MAX_KEYFRAME_SPACING` is documented as "the maximum number of frames from one key frame to the next". The word doing the damage is **frames**. Almost every caller wants an interval in *time*, and converts:

```go
spacing := int(keyframeInterval / time.Second) * frameRate   // 2s * 30fps = 60
```

That conversion is correct only while frames are actually submitted at `frameRate`. In a screen-capture pipeline they are not, and the gap between the two is enormous rather than marginal.

Desktop capture is inherently variable rate. DXGI Desktop Duplication reports *presents*, not pixels: a desktop nobody is touching stops presenting and `AcquireNextFrame` returns `DXGI_ERROR_WAIT_TIMEOUT` indefinitely. Most implementations therefore add a repaint floor that pushes roughly one frame per second so the stream does not freeze. The moment that floor is the only thing feeding the encoder:

```
spacing 60 frames  at 30 fps (busy screen)  = 2 seconds     as intended
spacing 60 frames  at  1 fps (still screen) = 60 seconds    not as intended
```

So a session against a POS terminal, a kiosk, a signage box, or any machine parked on a static screen contains **exactly one keyframe, at the start**, for its first minute.

Nothing reports this. The encoder is healthy, the transform accepts every frame, samples flow, and the capture loop logs success. The failure only becomes visible through a *second* fault: a receiver that misses the opening IDR. A full-screen 1280x1024 keyframe fragments into hundreds of RTP packets and a decoder needs all of them before it can produce one pixel. Lose one, and the receiver has nothing to build on and no second chance for a minute. On a thirteen-second session, that is the whole call, black, with both ends reporting health.

There is no single frame count that fixes it, which is the trap's real shape. A count small enough to give 2 seconds at 1 fps (spacing 2) produces a keyframe every 66ms on a busy screen and destroys the bitrate. The unit is simply wrong for a variable-rate source.

## WRONG

```go
// Intends "a keyframe every two seconds". Delivers that only at full rate.
func (e *mfEncoder) keyframeSpacing() int {
    spacing := int(e.config.keyframeInterval() / time.Second * time.Duration(e.config.FrameRate))
    if spacing < 1 {
        spacing = e.config.FrameRate
    }
    return spacing
}

_ = attrs.setUINT32(&mfMTMaxKeyframeSpacing, uint32(e.keyframeSpacing()))
// Error discarded too: a transform that refuses the attribute leaves you on
// whatever GOP the vendor chose, which can be longer still.
```

## RIGHT

```go
// Keep MF_MT_MAX_KEYFRAME_SPACING as the fast-path bound, and add a wall-clock
// floor that does not care how many frames were submitted.
const keyframeRefreshInterval = 4 * time.Second
const minKeyframeRequestGap    = 2 * time.Second   // a receiver spamming PLI must not thrash the encoder

func keyframeDue(lastKeyframe, lastRequest, now time.Time, sending bool) bool {
    if !sending {
        return false   // nothing is going out; a keyframe fixes nothing
    }
    if !lastRequest.IsZero() && now.Before(lastRequest.Add(minKeyframeRequestGap)) {
        return false
    }
    if lastKeyframe.IsZero() {
        return true    // sending, and none of it has been a keyframe
    }
    return !now.Before(lastKeyframe.Add(keyframeRefreshInterval))
}
```

Forcing one without new COM plumbing: **reconfigure the encoder with the config it already has.** A rebuilt Media Foundation pipeline's first output sample is an IDR carrying its parameter sets, so an existing `Reconfigure`/rebuild path is already a force-keyframe primitive, on every platform, with tests you probably already have.

```go
func (s *Stream) RequestKeyframe(reason string) {
    // rate-limit, then:
    _ = encoder.Reconfigure(currentConfig)   // first sample after a rebuild is a keyframe
}
```

## NOTES

- On a busy screen the wall-clock floor never fires, because frames arrive fast enough that the transform's own spacing produces a keyframe first. It only engages in exactly the case the frame count gets wrong.
- The alternative is `ICodecAPI::SetValue(&CODECAPI_AVEncVideoForceKeyFrame, 1)` before the next input sample. It is the "proper" answer and it is Windows-only, needs an extra COM interface, and vendor MFTs differ in whether they honour it. If you already have a rebuild path, that is cheaper and cross-platform.
- Set the attribute's error, do not discard it. `_ = attrs.setUINT32(...)` on a transform that refuses the attribute leaves you on the vendor's default GOP with no signal.
- The same unit confusion applies to `CODECAPI_AVEncMPVGOPSize`. Both are counts, never durations.
- If your receiver is WebRTC, this pairs with an unread `RTPSender` RTCP stream: the receiver sends PLI asking for exactly the keyframe you are not producing, and if nothing reads and parses that RTCP, both recovery paths are dead at once. Reading the sender restores NACK only; PLI needs parsing plus an encoder-side keyframe request.
- Diagnostic worth adding before you need it: count keyframes actually written to the transport and log the count periodically. "samples=300 keyframes=1" after ten seconds names this instantly.
