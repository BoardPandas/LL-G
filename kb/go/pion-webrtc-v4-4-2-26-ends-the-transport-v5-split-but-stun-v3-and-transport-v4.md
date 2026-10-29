---
tech: go
tags: [pion, webrtc, transport, stun, go-modules, supersedes-pion-transport-v5-split]
severity: medium
---
# pion webrtc/v4 4.2.26 ends the transport/v5 split, but stun/v3 and transport/v4 imports must be ported to drop v4

## PROBLEM
Since pion/webrtc/v4 v4.2.26 requires pion/transport/v5, the old workaround (`go get github.com/pion/transport/v5@none` to hold everything on v4, per go/pion-transport-v5-split) is obsolete, and your own code still importing `pion/stun/v3` or `pion/transport/v4` keeps the v4 line in the graph.
It is not obvious because the build succeeds with both lines present. `stun/v3` (latest v3.1.7) itself requires transport/v4, so `go get github.com/pion/transport/v4@none` silently downgrades `stun/v3` to an old release instead of removing it. Test helpers that implement `transport.Net` against v4 also stop matching what `SettingEngine.SetNet` now expects.

## WRONG
```go
import (
	"github.com/pion/stun/v3"
	"github.com/pion/transport/v4"
	"github.com/pion/transport/v4/stdnet"
)
// then: go get github.com/pion/transport/v4@none  -> downgrades stun/v3 to v3.1.0
```

## RIGHT
```go
import (
	"github.com/pion/stun/v4"      // same ParseURI / SchemeType / ProtoType API
	"github.com/pion/transport/v5" // same Net / UDPConn / TCPListener interfaces
	"github.com/pion/transport/v5/stdnet"
)
```
```bash
go get github.com/pion/webrtc/v4@v4.2.26   # pulls interceptor, rtcp, ice, dtls, srtp, sctp, turn forward
go get github.com/pion/stun/v3@none
go get github.com/pion/transport/v4@none
```

## NOTES
- Supersedes go/pion-transport-v5-split (written against webrtc 4.2.20).
- Check `go mod why -m github.com/pion/stun/v3` and `.../transport/v4` before `@none`; whatever still imports them must be ported first.
- If the module keeps audited floors that `go mod tidy` would prune, use targeted `go get` as above rather than tidy.
