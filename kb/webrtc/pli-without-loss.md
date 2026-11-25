---
tech: webrtc
tags: [webrtc, pli, chromium, jitter-buffer, rtcp, latency]
severity: medium
---
# Chromium sends PLI on a lossless link when the stream goes quiet

## PROBLEM
A screen-share sender that sends nothing while the screen is still makes the libwebrtc receiver time out waiting for frames and send a PLI, with zero lost packets and zero NACKs. Code that reads any PLI as "the link dropped a frame" and reacts (raising jitterBufferTarget, cutting bitrate) adds latency to a clean link. Seen live: a 16 ms, 0%-loss session held a 150 ms receive buffer for most of its life.

## WRONG
```ts
const lossy = plis > 0 || lostFraction >= 0.01;
```

## RIGHT
```ts
const lossy = (plis > 0 && (lost > 0 || nacks > 0)) || lostFraction >= 0.01;
```

## NOTES
Pair the PLI delta with lost/NACK deltas from the same inbound-rtp interval.
