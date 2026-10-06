---
tech: data-viz
tags: [elkjs, d3-hierarchy, bundle-size, react-flow]
severity: medium
---
# elkjs costs ~480 KB gzipped; a pure tree only needs d3-hierarchy

## PROBLEM
React Flow examples reach for elkjs for layered layouts. Its bundled build is ~480 KB gzipped, blowing a per-route chunk budget, yet a genealogy/lineage chart is a tree, which needs no general graph layouter.

## WRONG
```ts
import ELK from "elkjs/lib/elk.bundled.js"; // ~480 KB gz for a tree
```

## RIGHT
```ts
import { hierarchy, tree } from "d3-hierarchy";
tree<Node>().nodeSize([W + gapX, H + gapY])(hierarchy(root, (d) => d.children));
```

## NOTES
See also tidy-tree-wide-fanout-needs-comb-lanes.md for wide trees.
