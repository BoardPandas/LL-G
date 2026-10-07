---
tech: browser
tags: [pointer-events, touch, pinch-zoom, browser-testing, accessibility]
severity: high
---
# Ctrl-wheel zoom does not prove two-touch pinch

## PROBLEM
A desktop trackpad pinch can arrive as a `wheel` event with `ctrlKey`, so a handler for that path
looks like complete pinch support in desktop testing. On a touchscreen, two contacts arrive as two
pointer/touch streams instead. If the surface also uses `touch-action: none`, the browser will not
perform native pinch zoom for it. The feature can therefore pass trackpad and wheel tests while real
two-finger pinch does nothing.

## WRONG
```js
surface.addEventListener("wheel", (event) => {
  if (!event.ctrlKey) return;
  zoomAround(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.01));
});

// A ctrl+wheel browser test is treated as proof of touch pinch support.
```

## RIGHT
```js
const touches = new Map();

surface.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touches.size === 2) beginPinch([...touches.values()]);
});

surface.addEventListener("pointermove", (event) => {
  if (!touches.has(event.pointerId)) return;
  touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (touches.size >= 2) updatePinch([...touches.values()].slice(0, 2));
});

// Verify with two independently identified touch contacts, not ctrl+wheel.
```

## NOTES
Keep the table point beneath the initial two-touch midpoint fixed while distance and midpoint change;
that supports pinch zoom and two-finger pan together. Test cleanup on pointer up/cancel and the
handoff to the remaining contact as well as the zoom math.
