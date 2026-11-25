---
tech: webrtc
tags: [remote-desktop, cursor, latency, pacing, keyframe]
severity: medium
---
# A pointer drawn into the video lags by every frame-pacing hold

## PROBLEM
A remote-desktop sender that composites the cursor into frames moves the pointer only when a frame is sent. Once a quality floor and a frame pacer are added (big frames hold the next capture until they drain), the pointer trails the user by seconds. A "re-send the still picture as a keyframe once it settles" rule made it worse: a one-second pause between drags looked settled, so the largest frame of the session went out just as the user moved again.

## WRONG
```text
capture(withCursor: true)
if now - lastPixelChange > 1s { forceKeyframe() }
```

## RIGHT
```text
capture(withCursor: false); sendCursorPositionAndShape(controlChannel)
// viewer: CSS cursor = remote shape while driving
if now - lastPixelChange > 3s && now - lastInput > 3s { forceKeyframe() }
// and cap the pacer hold while input is arriving on a clean link
```
