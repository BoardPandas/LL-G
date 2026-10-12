---
tech: magic-tcg
tags: [proxy-rendering, card-frames, text-clearance, pt-plates, visual-acceptance]
severity: high
---
# Hash-bound clearance rectangles do not prove quiet glyph support

## PROBLEM

A frame can bind a reviewed clearance rectangle to exact source and derived asset hashes, render real P/T glyphs, and still visibly print part of a digit on a dark plate rail. The hash proves only that the annotation belongs to those bytes; it does not prove that the annotated rectangle is the pale numeral inset. A generous rectangle can include both the intended quiet field and a decorative border. Mean contrast over the P/T digit zone can remain high while only the top rows of a glyph cross onto the dark border, so both checks pass with a visibly wrong card.

## WRONG

```ts
await assertPaintedClearance({
  annotation: hashBoundPtRectangle,
  artwork: { source, asset },
  glyphs: [actualPtGlyphs],
});
expect(meanContrast(ptDigitZone)).toBeGreaterThan(minimum);
```

## RIGHT

```ts
const plate = placePtPlateAtFinalCardCoordinates(ptPlate, plateBounds);
for (const pixel of actualPtGlyphs.opaquePixels()) {
  expect(quietMask.has(pixel.x, pixel.y)).toBe(true);
  expect(compositedPlateLuminance(plate, pixel.x, pixel.y)).toBeAtLeast(quietFieldFloor);
}
```

## NOTES

Keep hash-bound clearance evidence, but treat it as provenance rather than proof that the annotation describes the quiet painted surface. For dark custom P/T ink, require each actual glyph pixel to sit on a near-opaque, high-luminance plate field (or on an independently hash-bound quiet mask). Add a negative fixture whose opaque dark strip crosses only the first rows of a digit: it must fail even when its full rectangle and mean contrast pass. Fix the plate art around fixed renderer coordinates; do not move text to accommodate the art.
