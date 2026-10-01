---
tech: data-viz
tags: [svg, sparkline, preserveAspectRatio, circle, markers, css]
severity: low
---
# A sparkline with preserveAspectRatio="none" stretches its point markers into ellipses

## PROBLEM
A responsive sparkline usually sets `viewBox` plus `preserveAspectRatio="none"` so the
line fills any width. That scales the x and y axes independently for everything inside
the SVG, so an end-point `<circle>` becomes a flat ellipse. `vector-effect:
non-scaling-stroke` fixes line thickness, but not the shape.

## WRONG
```tsx
<svg viewBox="0 0 120 32" preserveAspectRatio="none" className="w-full h-8">
  <polyline points={pts} vectorEffect="non-scaling-stroke" />
  <circle cx={x} cy={y} r={2.5} />
</svg>
```

## RIGHT
```tsx
<div className="relative h-8 w-full">
  <svg viewBox="0 0 120 32" preserveAspectRatio="none" className="h-full w-full">
    <polyline points={pts} vectorEffect="non-scaling-stroke" />
  </svg>
  <span className="absolute h-[5px] w-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current"
    style={{ left: `${x / 120 * 100}%`, top: `${y / 32 * 100}%` }} />
</div>
```
