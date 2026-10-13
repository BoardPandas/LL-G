---
tech: vitest
tags: [image-tests, canvas, alpha, compositing, visual-regression]
severity: medium
---
# Near-opaque pixels still blend with their backdrop

## PROBLEM

A rendered-pixel test compares the same colored overlay over different backgrounds
and assumes alpha 250 out of 255 is opaque. Correct pixels then fail equality:
about two percent of each backdrop still contributes to the final result. An
unchanged Gold card plate over two differently colored frames can differ by more
than a two-channel-value tolerance along its antialiased edge.

Fractional production placement adds resampling. Hundreds of fully opaque source
pixels can become a handful of fully opaque placed pixels, and those remaining
pixels may be neutral ornament rather than the color being verified. A raw-source
pixel count does not establish a valid minimum for placed, color-distinct evidence.

## WRONG

```ts
// The backdrop differs; near-opaque is not backdrop-independent.
if (placedAlpha >= 250) {
  expect(actualPairComposite).toEqual(goldBackgroundComposite);
}
// Nor does "64 opaque source pixels" imply 64 after fractional placement.
```

## RIGHT

```ts
// Keep the production transform, alpha, layer order and actual backdrop.
const expected = compositeAtProductionBounds(goldPlate, pairBackdrop);
const wrong = compareUnoccludedPlatePixels(actual, expected, glyphMask);
expect(wrong).toBe(0);
expect(countColorDistinctEvidence(expected, wrongColorExpected)).toBeGreaterThan(0);
```

For a deliberately backdrop-independent assertion, compare only alpha exactly
255 after placement and assert that enough relevant, color-distinct pixels were
actually tested. If that evidence is absent, use the backdrop-aware oracle above;
do not silently omit the policy check or flatten valid artwork to make it pass.

## NOTES

- Scalar source-over for opaque backdrops is `out = alpha * foreground +
  (1 - alpha) * backdrop`; alpha is normalized to 0..1.
- A regression should show alpha250 transmitting different backgrounds and
  alpha255 blocking them, plus rejection of an intentionally wrong overlay color.
- Keep source replay, alpha preservation and final composite policy as separate
  assertions. None replaces the others.
- This was observed in a frame-family Gold P/T test at fractional canvas bounds,
  not a renderer or artwork defect. Preserve the actual production transform.
