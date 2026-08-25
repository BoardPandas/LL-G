---
tech: webrtc
tags: [h264, profile-level-id, sdp, level, maxfs, macroblocks, hardware-decoder, black-video, remote-desktop, screen-share]
severity: high
---
# profile-level-id=42e01f caps you at 1280x720, and a hardware decoder answers a bigger picture with silence

## PROBLEM

`profile-level-id=42e01f` is the value in almost every WebRTC sample, tutorial and copied config. The trailing `1f` is hex 31, meaning **H.264 Level 3.1**, whose `MaxFS` (Table A-1) is **3600 macroblocks**. That is exactly 1280x720, which is what video calling sends, which is why `1f` is the number everybody has memorised.

A screen is not a webcam:

| Resolution | Macroblocks | vs Level 3.1 |
|---|---|---|
| 1280x720 | 3600 | exactly at the ceiling |
| 1280x1024 | 5120 | 42% over |
| 1920x1080 | 8160 | 127% over |
| 2560x1440 | 14400 | 300% over |
| 3840x2160 | 32400 | 800% over |

So any screen-sharing or remote-desktop stream that declares `42e01f` and then encodes a real display is advertising a stream materially smaller than the one it sends.

The failure is silent and looks like something else entirely. A decoder is entitled to size its buffers from the negotiated level **before a single byte of bitstream arrives**, and a hardware decoder does exactly that. Chromium prefers the platform hardware path (D3D11/Media Foundation on Windows, VideoToolbox on macOS), configures it for 3600 macroblocks, is handed 5120, and then:

- does not raise an error
- does not fall back to the software decoder
- does not tell JavaScript anything
- produces **no frames at all**

What you observe is a fully connected session: ICE connected, DTLS up, `ontrack` fired, a `MediaStream` attached to the `<video>`, `bytesReceived` climbing, and `framesDecoded` stuck at zero forever. Both ends report health.

It gets worse, because a `<video>` that never decodes has `videoWidth === 0`, and any code mapping a click into remote coordinates divides by or bounds-checks against that. So the same defect that blanks the picture also silently kills mouse input, and the two present as unrelated bugs.

The killer property: **it reproduces on a 1280x1024 terminal and not on a 1280x720 laptop.** It reads as "certain machines are broken", which sends you to the endpoint, the GPU driver, the network, and the capture stack, in that order, for days.

## WRONG

```go
// Copied from every WebRTC example on the internet. Fine for a 720p webcam,
// wrong for any screen.
const fmtp = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"

track, _ := webrtc.NewTrackLocalStaticSample(
    webrtc.RTPCodecCapability{
        MimeType:    webrtc.MimeTypeH264,
        ClockRate:   90000,
        SDPFmtpLine: fmtp,
    }, "screen", id)

// ...and then encode whatever the display happens to be:
encoder.Configure(1280, 1024)   // 5120 macroblocks into a 3600 promise
```

## RIGHT

```go
// Declare a level that covers what you will actually send. 0x33 = 51 =
// Level 5.1, MaxFS 36864, which covers every display up to 4K, so the
// declared level stops being a per-endpoint correctness question.
const level = "33"
const fmtp = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e0" + level
```

```
Level  Hex   MaxFS    Largest 16:9-ish display it covers
3.1    1f     3600    1280x720
3.2    20     5120    1280x1024
4.0    28     8192    1920x1080
5.0    32    22080    2560x1440
5.1    33    36864    3840x2160
```

Guard it with a test rather than a comment, because the next person will copy `1f` back in:

```go
func TestLevelCoversRealDisplays(t *testing.T) {
    maxFS := map[string]int{"1f": 3600, "20": 5120, "28": 8192, "32": 22080, "33": 36864}
    level := profileLevelID[4:]
    for _, d := range []struct{ w, h int }{{1280,720},{1280,1024},{1920,1080},{3840,2160}} {
        mbs := ((d.w+15)/16) * ((d.h+15)/16)
        if mbs > maxFS[level] {
            t.Errorf("level %s allows %d MBs; %dx%d needs %d", level, maxFS[level], d.w, d.h, mbs)
        }
    }
}
```

## NOTES

- **Raising the level cannot break negotiation.** pion's `profileLevelIDMatches` (`internal/fmtp/h264.go`) compares only `profile_idc` and `profile_iop`, bytes 0 and 1. The level byte is not part of the match. libwebrtc behaves the same way. So you can advertise 5.1 and still match a browser offering `42e01f`.
- `level-asymmetry-allowed=1` is the flag that makes this legal: RFC 6184 says the level may differ between the two directions. If you are sending, declare the level you send at.
- Macroblocks are `ceil(w/16) * ceil(h/16)`, so odd heights round up: 1080 gives 68 rows, not 67.5.
- Diagnose with `getStats()`, not connection state. `iceConnectionState` reaches `connected` and stays there. The fields that tell the truth are `framesDecoded` (stuck at 0), `frameWidth` (0), and `decoderImplementation`. `bytesReceived` climbing with `framesDecoded` at 0 is this bug's exact signature.
- A software decoder is often more forgiving than a hardware one, so this can reproduce on one machine and not another with identical resolutions, purely on which decoder Chromium picked.
- Related trap on the same code path: a track created with an **empty** `SDPFmtpLine` in pion can never exact-match and binds to the offerer's first H.264, which may be `packetization-mode=0`. Same black-video symptom, different cause. See the Go slice.
