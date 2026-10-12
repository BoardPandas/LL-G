---
tech: browser
tags: [canvas, image-format, jpeg, png, pixel-tests, visual-regression]
severity: high
---
# Lossy image output invalidates exact pixel comparisons

## PROBLEM

A renderer can return JPEG by default even when the caller names its buffer `png`.
Comparing decoded JPEGs pixel-for-pixel then attributes compression ringing and
block effects to the renderer's masks, colors, or alpha compositing. Changing one
side of a sharp split can alter nearby pixels on the unchanged side. A tolerance
increase or a hand-picked excluded seam can hide the test error and later hide a
real rendering regression.

In one canvas frame-family test, a supposed 15-pixel antialias seam was not in the
SVG at all: the loaded mask had only alpha 0/255. The renderer's final JPEG encode
was the unmodeled transformation. Inspect the actual output format and the
encoder path before diagnosing compositing from decoded pixels.

## WRONG

```ts
const png = await renderCard(options); // actually JPEG by default
const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
// Compare exact colors, then skip an unexplained border when assertions fail.
```

## RIGHT

```ts
const png = await renderCard({ ...options, transparentLayer: true });
expect((await sharp(png).metadata()).format).toBe("png");
const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
// Compare lossless opaque interiors for exact source-color placement.
```

## NOTES

The lossless option above is specific to that renderer; inspect each API rather
than assuming its name. Prefer raw canvas pixels or an explicit PNG path for
compositing invariants. Qualify samples using the component's actual placed alpha,
not a nearest source pixel when scaling introduces interpolation. Keep separate
visual checks on the production JPEG output, because a lossless test alone does
not prove the exported image's readability.
