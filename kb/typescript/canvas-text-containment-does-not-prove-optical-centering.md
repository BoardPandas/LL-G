---
tech: typescript
tags: [canvas, typography, image-compositing, validation]
severity: high
---

# Canvas text containment does not prove optical centering

## Problem

A Canvas card renderer can pass nominal-box containment, painted-clearance, and contrast checks while the finished title, type line, or power/toughness glyphs visibly sit high or low in the painted reading inset. `ctx.textBaseline = "middle"` centers a font metric, not the actual ink, and a frame's opaque bounds or clearance annotation need not be the pale inner row the reader perceives. This is silent wrong output: the image renders and every containment assertion can be green.

In one 15-frame review, measured painted title-row centers ranged from 171 to 200.5 pixels. A Gundam frame's old title appeared 18--20 pixels high; Pirate and Bunnies examples were crowded against a rail even though their glyphs were contained.

## Wrong

```ts
ctx.textBaseline = "middle";
ctx.fillText(title, titleX, titleBox.y + titleBox.height / 2);
assertPaintedClearance(titleBox); // proves containment, not optical centering
```

Using the full opaque bar, a zero-alpha rectangle, or an inferred clearance center as the visual target has the same flaw: decorative rails and crowns can make that geometry differ from the actual pale reading row.

## Right

For an opted-in family, measure the actual painted inner reading row from its source/derived art and bind that measurement to the exact source and asset hashes used to render. After final font fitting, solve the alphabetic baseline from the visible glyph bounds:

```ts
const metrics = ctx.measureText(fittedTitle);
const centerY = paintedTitleRowCenter;

ctx.textBaseline = "alphabetic";
const baseline = centerY +
  (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
ctx.fillText(fittedTitle, titleX, baseline);
```

Center the mana-symbol bodies on that same measured title row while preserving their established right anchor. Apply equivalent post-fit visible-glyph centering to the type line and P/T row, and center the set-icon body on the type row. Exclude drop shadows from the ink measurement so the shadow does not move the reading target.

Keep the row metadata optional: a family without it must keep its legacy rendered bytes unchanged. Do not change horizontal anchors, font fitting, or crown/body geometry merely to correct vertical optical alignment.

## Verification

Render and measure the actual composited glyph/body centers, not just input coordinates. Require every fitted title, type line, and P/T value to be within 2 px of its hash-bound painted row, including short labels, descenders, long fitted labels, seven-pip titles, all color variants, and legendary variants. Retain an independent painted-clearance assertion: optical centering does not prove the text avoids frame hardware.

Use a negative fixture whose dark rail permits a small low-contrast glyph row to pass mean-contrast/rectangle checks; the direct glyph-underlay check must fail it.
