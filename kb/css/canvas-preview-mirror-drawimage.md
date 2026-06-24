---
tech: css
tags: [canvas, drawImage, object-fit, preview, transform, image-framing]
severity: medium
---
# A CSS live-preview of a canvas drawImage composite must mirror drawImage exactly, not use object-fit:cover

## PROBLEM
When you build an in-browser editor that previews how an image will be composited by a server-side canvas (e.g. `@napi-rs/canvas` `drawImage` with cover-fit plus a pan/zoom transform), it is tempting to render the preview `<img>` with `object-fit: cover` and layer a CSS `transform` on top, computing the translate/scale from the image's natural dimensions. This silently does NOT match the renderer. `object-fit: cover` already discards the image outside the center crop, so a pan can only slide the *visible crop*, not reveal more source -- panning appears broken or muted, and the translate term is off by `(imgWidth*coverScale - containerWidth)/2`. The preview looks plausible, so the user saves a framing that lands differently than the editor showed. Classic silent-wrong-output: no error, wrong result.

## WRONG
```css
.preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;        /* already crops to the center -- pan can't reveal more */
  transform-origin: 0 0;
}
```
```js
// transform computed from natural size, but object-fit already re-cropped the box
const es = coverScale * userScale;
img.style.transform = `translate(${dx}px,${dy}px) scale(${es / coverScale})`;
```

## RIGHT
```css
.preview-img {
  max-width: none;          /* let JS size it to natural pixels */
  transform-origin: 0 0;    /* match canvas drawImage origin (top-left) */
}
```
```js
// Render the <img> at its NATURAL size, then apply the FULL transform so the CSS
// box maps 1:1 to canvas drawImage(img, dx, dy, iw*es, ih*es).
img.width = img.naturalWidth;
img.height = img.naturalHeight;
const coverScale = Math.max(containerW / iw, artH / ih); // same cover-fit the canvas uses
const es = coverScale * userScale;
const dx = (containerW - iw * es) / 2 + offsetX * containerW;
const dy = (artH       - ih * es) / 2 + offsetY * artH;
img.style.transform = `translate(${dx}px,${dy}px) scale(${es})`;
```

## NOTES
The invariant: the CSS preview's `translate(dx,dy) scale(es)` over a natural-size image must be the exact arguments the canvas runs as `drawImage(img, dx, dy, iw*es, ih*es)`, with `transform-origin: 0 0` because canvas draws from the top-left. Verify by rendering an identity transform (should be byte-identical to the un-transformed baseline) and a pan/zoom (should change pixels). Discovered in the TCG proxy-pipeline per-card art-framing feature (shipped 3.66.0.0). Browser subpixel rendering still differs slightly from `@napi-rs/canvas`, so the preview is directionally exact but not pixel-perfect -- a final render confirms the crop.
