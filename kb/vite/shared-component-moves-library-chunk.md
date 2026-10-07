---
tech: vite
tags: [bundle-budget, code-splitting, lazy, shared-chunk, rolldown]
severity: medium
---
# Sharing a heavy component between two lazy routes moves the library into a new shared chunk

## PROBLEM
A per-chunk gzip budget matched chunks by name prefix (`LineageView-` at 180 KB) and gave every other chunk a
small default (60 KB). When a second lazy view reused the chart component, the bundler moved React Flow out of
`LineageView-*.js` into a new shared chunk named after the component (`LineageCanvas-*.js`). The old row now
guarded a 2 KB file, and the library fell under the 60 KB default. It happened to fit at 44 KB, but a slightly
heavier library fails CI with a confusing "shared chunk" error, or worse, a stale generous row hides growth.

## WRONG
```js
const BUDGETS = [{ prefix: "LineageView-", max: 180 * KB, what: "lineage view" }];
const DEFAULT_MAX = 60 * KB; // everything else
```

## RIGHT
```js
const BUDGETS = [
  { prefix: "LineageView-", max: 180 * KB, what: "lineage view" },
  // React Flow lives here since the tree view reuses the lineage chart.
  { prefix: "LineageCanvas-", max: 180 * KB, what: "React Flow chart (lineage and tree views)" },
  { prefix: "TreeView-", max: 40 * KB, what: "tree view shell" },
];
```

## NOTES
After extracting a shared module, run the build and read the chunk list before trusting the budget table.
Size the new view's own row to its shell, not to the library it borrows.
