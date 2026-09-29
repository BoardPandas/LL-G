---
tech: magic-tcg
tags: [proxy-rendering, card-frames, art-cropping, visual-acceptance]
severity: high
---
# Complete source art can still fail card-frame visibility

## PROBLEM

A portrait source image can contain a complete object from end to end and still produce a bad Magic proxy. The renderer cover-fits the image beneath the title, type, and rules overlays, so blade tips, guards, grips, or pommels can disappear even though the upload hash matches and the render reports `rendered`. Source-image inspection, dimensions, hashes, and render status all pass; only inspection of the final composed card exposes the failure.

The `artFit: "stretch"` option corrects the 2:3-to-5:7 aspect-ratio crop. It does not move subject matter out from underneath card-frame overlays, so it cannot rescue an object that spans too much of the source image vertically.

## WRONG

```text
verify the approved source image shows the complete object
verify the uploaded bytes match the approved SHA-256
wait until render.status == "rendered"
declare the proxy accepted
```

## RIGHT

```text
verify the approved source image and uploaded SHA-256
wait for a terminal render state
download the composed card binary-safely
inspect every required landmark in the actual visible art window
if any landmark is hidden by frame overlays, reject and roll back
revise the composition for the real frame-safe window, then require fresh approval
```

## NOTES

Treat image acceptance and composed-card acceptance as separate gates. Preserve the approved source when the composite fails; do not regenerate merely to conceal a renderer or framing problem. For tall object-centered subjects, author against the actual visible art window rather than a generic 2:3 portrait safe area.
