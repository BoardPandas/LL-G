---
tech: webrtc
tags: [sfu, fan-out, pion, tracklocalstaticsample, screen-share, multi-viewer, dxgi, desktop-duplication, encoder, pli]
severity: medium
---
# One-to-many screen share needs no SFU: a single local track fans out to N PeerConnections

## PROBLEM

"Several people need to watch one screen" reads as a media-topology problem, and the reflex is an SFU: deploy mediasoup or Janus or LiveKit, route the publisher through it, subscribe the watchers. That is a piece of infrastructure to run, secure, scale and pay for, and for this shape it is usually unnecessary.

A local track in pion is not bound to one PeerConnection. `TrackLocalStaticSample` keeps a slice of bindings, `Bind` appends one per connection it is added to, and `WriteSample` writes to all of them. So the same track added to N PeerConnections is genuine fan-out from one encode:

```
N viewers  =  N RTP senders
           =  1 capture, 1 pixel conversion, 1 H.264 encode
```

The reason this matters more than as an optimisation, on a desktop-capture product specifically: **the capture device is often exclusive.** Windows Desktop Duplication (`IDXGIOutput1::DuplicateOutput`) permits one duplication per output, so "just run a second host process per viewer" is not a heavier version of the same design, it is a design that cannot work. One of the two processes gets `DXGI_ERROR_NOT_CURRENTLY_AVAILABLE`, or silently falls back to a slower path with different failure modes. Fan-out from one encoder is not a shortcut around an SFU; it is the only arrangement that captures once.

The second thing that collapses for free is keyframe requests. Every viewer that joins late or drops a packet sends PLI, and a naive handler forces an encoder keyframe per PLI. Ten viewers joining together become ten encoder rebuilds, during which nobody gets a picture. Routed through one rate-limited gate, ten simultaneous PLIs cost one keyframe.

What does **not** fan out is input. Video is broadcast; a mouse is not.

## WRONG

```go
// A host process, an encoder and a capture per viewer.
for _, viewer := range viewers {
    go runHostForViewer(viewer)   // second DuplicateOutput fails or degrades
}
```

```go
// Or: reaching for an SFU because "one publisher, many subscribers" sounds like one.
```

```go
// Or: honouring every PLI directly.
for _, packet := range rtcpPackets {
    if _, ok := packet.(*rtcp.PictureLossIndication); ok {
        encoder.ForceKeyframe()   // N viewers joining = N rebuilds
    }
}
```

## RIGHT

```go
// One track, created once.
track, _ := webrtc.NewTrackLocalStaticSample(codec, "screen", sessionID)

// One PeerConnection per viewer; the SAME track added to each.
func (s *viewerSet) ensure(peer string) (*viewer, error) {
    pc, err := s.api.NewPeerConnection(s.cfg)
    if err != nil { return nil, err }

    sender, err := pc.AddTrack(s.track)   // appends a binding; no second encode
    if err != nil { _ = pc.Close(); return nil, err }
    go drainSenderRTCP(s.ctx, s.log, sender, s.gate.request)  // per sender, one shared gate
    ...
}

// The capture loop is unchanged and unaware of how many people are watching.
track.WriteSample(media.Sample{Data: encoded, Duration: d})   // writes every binding
```

```go
// Every viewer's PLI reaches one rate-limited gate.
const minKeyframeRequestGap = 2 * time.Second
```

Decide the input model explicitly. "First viewer to fully connect drives, everyone after watches" is the smallest honest answer and needs no arbitration protocol:

```go
// The first viewer whose input and control channels open drives the session.
s.driverOnce.Do(func() { s.driverPeer = peer; s.driverReady <- v.channels })
```

## NOTES

- Reach for an SFU when you need per-viewer bitrate adaptation (simulcast/SVC selection), when viewers are numerous enough that N upstreams from one endpoint saturates its link, or when the publisher is a browser that cannot hold N connections. A handful of technicians watching one desktop over a relay is none of those.
- N senders still means N times the *upstream bandwidth* from the endpoint. Fan-out saves CPU and the capture device, not the uplink. On a customer machine on ADSL, that is the number to check before raising the viewer cap.
- Cap the viewer count. Unbounded PeerConnections on someone else's machine is a resource-exhaustion path, not a feature.
- The exclusivity point generalises past DXGI: macOS ScreenCaptureKit, camera devices, and audio loopback devices all have single-claimant behaviour on some platforms. If your source is exclusive, per-viewer processes are ruled out before performance is even discussed.
- Only the driver's connection state should end the session. If a watcher's PeerConnection failing tears the session down, you have reintroduced the eviction bug from the other direction.
