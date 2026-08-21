---
tech: media-foundation
tags: [mft, imftransform, encoder, lifetime, com, d3d11, leak, concurrency, mutex, go, teardown]
severity: high
---
# Rebuilding an MFT leaks it unless you close the old one first, and "first" means nothing without a lock

## PROBLEM

Settings baked into a transform's media type at creation -- bitrate/quality, grayscale, lossless -- cannot be
changed on a live MFT portably, so the usual design is to rebuild the encoder. A codebase typically grows two
rebuild paths that look unrelated: a frame-size change noticed by the capture loop, and a user changing quality
arriving on a control channel. They are the same operation, and they go wrong in the same two ways.

**1. Assigning over the encoder is not replacing it.** `state.encoder = newEncoder` drops the last reference a
garbage-collected language has to the old one, and nothing in Go, C# or Python calls `Close`/`Release` for you on
a COM object behind a hand-written vtable wrapper. The old transform, the activation object, and the COM thread
it was driven from stay alive for the life of the process. There is no error, no log line, and no failed frame:
the new encoder works, so the picture is correct and the only symptom is a session that gets slower the more the
user touches the setting. On a hardware rung it is worse than a memory leak -- for the moment before the old one
would have been released you have two hardware MFTs alive on the one shared `ID3D11Device`, which is the
configuration that hangs or bugchecks some drivers.

**2. Stop-then-start in one path is not stop-then-start in the program.** Having decided to tear down before
building (the ordering that keeps only one transform alive at a time), it is tempting to write
`stop(); start(...)` at each call site. But `stop()` sets `encoder = nil`, and a nil encoder is exactly what the
capture loop tests to decide *it* should build one. The two paths are different goroutines/threads. So the
control path's `stop()` hands the capture loop the nil it is looking for, and both build a transform
simultaneously -- the same overlap the ordering was chosen to avoid, reached from the other direction, and a
worse instance of it: two being constructed at once rather than one alive next to another. The bug is invisible
in tests, because it needs a capture tick to land inside a window a few milliseconds wide.

The two failures disguise each other. Fixing only the first (adding the `Close`) introduces the second.

## WRONG

```go
// Path A -- the capture loop, which got this right.
if s.encoder == nil || frame.Width != s.config.Width {
	s.stopEncoder()                              // closes it, sets s.encoder = nil
	s.startEncoderFor(frame.Width, frame.Height)
}

// Path B -- a quality change arriving on the control channel. Same operation,
// written independently, and it never stops.
func (s *Stream) applyVideoSettings(p Settings) error {
	s.mu.Lock()
	s.config = resolve(p, s.config)
	s.mu.Unlock()
	// startEncoderFor does `s.encoder = built` under the mutex. Whatever was
	// there is now unreachable and was never Closed: an MFT, its activation
	// object and its COM thread, leaked per message, for the whole session.
	return s.startEncoderFor(s.config.Width, s.config.Height)
}

// And the tempting half-fix, which trades the leak for a race:
func (s *Stream) applyVideoSettings(p Settings) error {
	// ...
	s.stopEncoder()   // s.encoder = nil -- Path A now decides to build one too
	return s.startEncoderFor(s.config.Width, s.config.Height)
}
```

## RIGHT

```go
// One rebuild function, and it is the only thing either path calls.
//
// The mutex is the load-bearing part, and it is separate from the mutex
// guarding ordinary state: a build is slow (it constructs an MFT and can touch
// a D3D device), and the state lock is taken on every captured frame.
type Stream struct {
	mu      sync.Mutex // ordinary state, including the encoder pointer
	rebuild sync.Mutex // serializes teardown-and-build across all callers
	encoder VideoEncoder
	config  EncoderConfig
}

func (s *Stream) rebuildEncoderFor(width, height int) error {
	s.rebuild.Lock()
	defer s.rebuild.Unlock()
	s.stopEncoder() // Close the old one, then s.encoder = nil.
	return s.startEncoderFor(width, height)
}

// Both paths now go through it.
if s.encoder == nil || frame.Width != s.config.Width {
	err = s.rebuildEncoderFor(frame.Width, frame.Height)   // capture loop
}
err = s.rebuildEncoderFor(s.config.Width, s.config.Height) // control channel
```

Three consequences to accept deliberately, not discover later:

- **The picture pauses for the length of the build,** not just for the keyframe, because nothing is encoding while
  `encoder` is nil. That is the price of never having two transforms alive; the alternative is the overlap.
- **A tick that read the encoder pointer just before the stop will encode into a closed transform.** Make every
  implementation answer that with an error, checking a `closed` flag under *the same mutex* `Close` takes, so the
  transform itself is never touched concurrently. The caller logs one failed frame. Without that guard you
  dereference a released COM object on the driving thread and take the process with it.
- **A caller that waited on `rebuild` may rebuild an encoder that is already correct.** One wasted build in a
  narrow race, serialized and therefore safe. Do not try to skip it by comparing the stored config -- the control
  path updates that config *before* rebuilding, so "the config matches" is true both when somebody else already
  fixed it and when the settings just changed underneath you. They are the same state.

Do not clear the stored config in `stop()`. `encoder == nil` is what says there is no encoder; the config is what
says how to build the next one, and zeroing it silently drops exactly the fields (grayscale, lossless) that a
rebuild exists to carry.

## NOTES

- **Testing it needs a seam.** Every rung of a real encoder ladder returns "unsupported" on a CI box or a
  developer machine with no GPU, so a test can never get a *previous* encoder for the rebuild to mishandle. Add a
  builder function field to the stream (nil meaning the real ladder) and hand out fakes that record `Close`.
  Without it the leak is untestable and will come back.
- **Assert across several rebuilds, not one.** A single-rebuild test passes on code that closes only the encoder
  the session started with and nothing after it. Drive three or four changes and assert every encoder but the
  last is closed. (Same trap as the `go` slice's "a test that asserts properties of a sequence proves nothing when
  the fixture makes one element".)
- **Check teardown too.** If session teardown calls `stop()` without taking the rebuild lock, a rebuild in flight
  can assign a freshly built encoder *after* teardown already stopped one, leaking it at exit. Fixing that needs a
  closed-check inside the build, not just the lock.
- Related: [hardware-mft-needs-d3d-manager.md](hardware-mft-needs-d3d-manager.md) -- why the hardware rung has a
  D3D device to share in the first place, and therefore why an overlap is dangerous rather than merely wasteful.
- Found in a Go/Wails remote-control agent (SupportForge desktop agent), but nothing here is Go-specific beyond
  the syntax: any language where dropping a reference does not release a COM object has both halves of this.
