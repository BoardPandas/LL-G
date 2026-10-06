---
tech: data-viz
tags: [tree-layout, d3-hierarchy, react-flow, readability]
severity: medium
---
# A tidy tree with wide fan-out becomes an unreadable strip

## PROBLEM
Reingold-Tilford places every leaf side by side. With a few parents owning 12-29 leaves each, the tree is far wider than tall: fitting it makes names unreadable, and clamping minZoom crops it to a middle strip. Folding big families by default helps but does not fix the shape.

## WRONG
```ts
tree().nodeSize([W + 14, H + 64]) // 81 leaves in one row
```

## RIGHT
```ts
// per parent: leaves = kids without kids; stack them in lanes
const per = Math.max(2, Math.round(Math.sqrt(SHAPE * n * laneStep / slotStep)));
const even = Math.ceil(n / Math.ceil(n / per)); // 16 -> 8+8, not 12+4
// edge: parent port -> bus -> spine beside lane -> into the child's near side
```

## NOTES
Tune with the real data: render the computed layout to PNG (resvg) and look. Combing even 2-leaf families took the canon from 0.15x to ~0.6x fit zoom.
