---
tech: data-viz
tags: [camera, responsive, aspect-ratio, react-three-fiber, react-flow, fit-view]
severity: high
---
# Fixed camera assumptions silently crop responsive charts

## PROBLEM
A chart can render every record without an exception while keeping some records outside the initial viewport. Fitting a perspective map with a guessed aspect ratio works on the original desktop layout but crops its horizontal extent on a narrow phone canvas. Separately, a fit-to-view minimum zoom can override the computed fit and crop a large forest on every device.

In a fan atlas browser audit, the map assumed a 1.2 aspect ratio and tree fitting enforced a 0.5 minimum zoom. Actual phone canvases were taller than they were wide, and large independent forests exceeded the space available at 0.5. Page-level overflow checks passed: the missing content was clipped inside the visualization.

## WRONG
```ts
const distance = Math.max(halfHeight, halfWidth / 1.2) / tanHalfFov;
flow.fitView({ minZoom: 0.5 });
```

## RIGHT
Measure the canvas itself, reserve space for labels, and derive the camera distance from both projected axes. Recompute when the canvas dimensions or plotted bounds change, without resetting the camera on every animation frame.

```ts
const usableWidth = Math.max(width * 0.5, width - 120);
const usableHeight = Math.max(height * 0.5, height - 100);
const distance = Math.max(
  halfHeight * height / usableHeight,
  halfWidth * height / usableWidth,
) / Math.tan(fovDegrees * Math.PI / 360);
```

For a graph fit, allow the calculated zoom to contain the complete graph. Supply selection-to-focus and explicit zoom controls for reading detail; do not impose a readability floor that silently crops the overview. Pack disconnected root trees into rows before fitting instead of laying every root along one axis.

## NOTES
- Use the rendered canvas dimensions, not the browser window: a sidebar changes the available aspect ratio.
- Test both projected bounds and rendered node rectangles at portrait and landscape sizes. Checking document scrollWidth alone cannot detect internal clipping.
- Reserve label margins in pixels rather than assuming the same percentage works at every screen size.
- Keep the controls' maximum camera distance consistent with the computed fit; a smaller maximum can immediately undo a correct camera placement.
- Related: [Wide fan-out needs comb lanes](tidy-tree-wide-fanout-needs-comb-lanes.md).
