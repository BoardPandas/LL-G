---
tech: go
tags: [go, pion, webrtc, go-modules, go-get, transport, upgrade, mvs]
severity: high
---
# Newest pion sub-modules need transport/v5 but webrtc/v4 4.2.20 does not build against it

## PROBLEM
As of 2026-09 the newest pion sub-module releases (ice/v4 v4.4.3+, dtls/v3 v3.1.9,
sctp v1.11.2+, srtp/v3 v3.0.16+, stun/v4 v4.0.1, mdns/v2 v2.2.1, datachannel
v1.6.3, interceptor v0.1.49, turn/v5 v5.1.2) moved to
`github.com/pion/transport/v5`, while `pion/webrtc/v4` v4.2.20, the latest,
still uses transport/v4. `go list -m -u` shows them as ordinary minor and patch
updates, so `go get -u` looks routine and then fails to compile inside webrtc
itself:
- dtlstransport.go: BufferFactory type mismatch (transport/v4 vs v5 packetio)
- icegatherer.go: transport/v4 Net does not implement transport/v5 Net

## WRONG
```bash
go get -u github.com/pion/webrtc/v4   # pulls v5-based ice/dtls/sctp/...
go build ./...                          # fails inside pion/webrtc/v4
```

## RIGHT
```bash
go get -u github.com/pion/webrtc/v4
go get github.com/pion/transport/v5@none   # MVS rolls every dependent back to its
                                           # newest transport/v4-compatible release
go build ./...
```

## NOTES
- Re-check when `go list -m -u github.com/pion/webrtc/v4` shows a new release;
  that release is what unblocks the rest of the stack.
- `@none` is the general tool whenever a new major of a shared dependency splits
  an ecosystem: it removes the module and downgrades exactly the modules that
  require it.
