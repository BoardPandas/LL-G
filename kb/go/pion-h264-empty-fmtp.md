---
tech: go
tags: [pion, webrtc, h264, sdpfmtpline, packetization-mode, codec-negotiation, mediaengine, rtp, black-video]
severity: high
---
# A pion track with an empty SDPFmtpLine can never exact-match, so it binds to the offerer's first H.264

## PROBLEM

Creating a video track as `webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264}` looks like "H.264, defaults are fine". It is not. The empty `SDPFmtpLine` is load-bearing, and it is load-bearing in the worst direction.

`TrackLocalStaticSample.Bind` resolves the codec through `codecParametersFuzzySearch` (`rtpcodec.go`), which runs two passes:

1. exact: `MimeType` + `ClockRate` + `Channels` + fmtp, compared by `h264FMTP.Match`
2. partial: `MimeType` + `ClockRate` + `Channels` only, returning the **first** match

`h264FMTP.Match` (`internal/fmtp/h264.go`) reads `packetization-mode` out of both sides and returns `false` the moment either one is absent. An empty fmtp line has no `packetization-mode`, so pass 1 **cannot ever succeed**, not once, for any peer. Every session silently falls through to pass 2 and takes whatever H.264 payload type happens to sit first in the negotiated list.

That ordering is the *remote's*, not yours, whenever you are the answerer. Browsers offer several H.264 payload types and the order varies by browser version, platform and what the hardware advertises. When the first one is a `packetization-mode=0` entry the session is quietly broken: pion's H.264 packetizer still emits FU-A fragments for any NAL larger than the MTU (a full-screen IDR always is), and a decoder that negotiated mode 0 discards every one of them.

The symptom is maximally unhelpful. ICE connects, DTLS completes, the track is live, `bytesReceived` climbs, and the `<video>` element stays black forever because not one frame ever decodes. There is no error anywhere on either side.

It usually arrives with a second symptom that looks like an unrelated bug: a video element that never decodes has `videoWidth === 0`, and any code that maps a click into remote coordinates divides by or bounds-checks against that, so the mouse silently stops working too. One defect, two apparently separate faults, and the mouse one sends you to the input code.

## WRONG

```go
// "H.264, defaults are fine." The empty SDPFmtpLine guarantees the exact
// match never fires, so the codec is chosen by the offerer's ordering.
track, err := webrtc.NewTrackLocalStaticSample(
    webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeH264},
    "video", "stream",
)

// Compounding it: the default media engine registers packetization-mode=0
// variants and Main/High profiles, so the partial match has broken choices
// available to it.
pc, err := webrtc.NewPeerConnection(cfg)
```

## RIGHT

```go
// 1. Constrain what is negotiable. Register only variants you can actually
//    produce and the peer can actually decode, so even the partial match
//    cannot reach a broken choice.
const fmtpLine = "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"

feedback := []webrtc.RTCPFeedback{
    {Type: "goog-remb"}, {Type: "ccm", Parameter: "fir"},
    {Type: "nack"}, {Type: "nack", Parameter: "pli"},
}

media := &webrtc.MediaEngine{}
for _, c := range []webrtc.RTPCodecParameters{
    {PayloadType: 106, RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
        SDPFmtpLine: fmtpLine, RTCPFeedback: feedback}},
    // BOTH baseline spellings: profileLevelIDMatches compares profile_idc AND
    // profile_iop, so 42001f and 42e01f do not match each other. Register one
    // and be offered the other and you negotiate no video at all.
    {PayloadType: 102, RTPCodecCapability: webrtc.RTPCodecCapability{
        MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
        SDPFmtpLine: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f",
        RTCPFeedback: feedback}},
} {
    if err := media.RegisterCodec(c, webrtc.RTPCodecTypeVideo); err != nil {
        return err
    }
}

// 2. A hand-built MediaEngine gets NO interceptors. Register them or you lose
//    NACK, RTCP reports and TWCC, which is a real regression.
ir := &interceptor.Registry{}
if err := webrtc.RegisterDefaultInterceptors(media, ir); err != nil {
    return err
}
api := webrtc.NewAPI(webrtc.WithMediaEngine(media), webrtc.WithInterceptorRegistry(ir))
pc, err := api.NewPeerConnection(cfg)

// 3. Declare the track's fmtp, so the exact pass is the everyday path and the
//    partial pass is only a floor.
track, err := webrtc.NewTrackLocalStaticSample(
    webrtc.RTPCodecCapability{
        MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
        SDPFmtpLine: fmtpLine, RTCPFeedback: feedback},
    "video", "stream",
)
```

## NOTES

- Test it cheaply: build a PeerConnection from your API, `CreateOffer`, and assert the SDP contains no `packetization-mode=0` and none of `VP8`/`VP9`/`AV1`. That is a unit test with no peer and no network, and it fails loudly if someone re-adds a profile later.
- Match the registered profile to what your encoder actually emits. If the encoder is configured for Baseline (for example Media Foundation's `eAVEncH264VProfile_Base`), do not register Main or High: they will negotiate happily and then be fed a bitstream they did not agree to.
- Which side offers matters. If the browser calls `createOffer` you are the answerer and the codec ordering is entirely theirs, which is why this reproduces on some machines and not others and reads as flaky hardware.
- Do not diagnose this from connection state. `iceConnectionState` reaches `connected`, stats show packets arriving, and `framesDecoded` stays at 0. `framesDecoded` and `videoWidth` are the fields that actually tell you.
- Related trap in the same area: a Wails/webview binding that drops `URLs` because of struct tags will also produce a connection that "works on LAN and fails elsewhere". Different cause, similar shape, and both are worth ruling out together.
