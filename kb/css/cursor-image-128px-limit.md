---
tech: css
tags: [css, cursor, chromium, webview2, hotspot]
severity: medium
---
# Chromium ignores a CSS cursor image larger than 128 px

## PROBLEM
cursor: url(...) x y with an image over 128x128 is ignored by Chromium (and WebView2), which shows the fallback cursor with no error. Drawing a remote pointer at a large zoom hits this.

## WRONG
```ts
el.style.cursor = `url("${dataUrl}") ${hotX} ${hotY}, default` // 192x192 image
```

## RIGHT
```ts
const k = Math.min(1, 128 / Math.max(w, h));
// redraw at w*k x h*k on a canvas
el.style.cursor = `url("${small}") ${Math.round(hotX*k)} ${Math.round(hotY*k)}, default`
```

## NOTES
Keep the hotspot inside the scaled image (clamp to width-1/height-1).
