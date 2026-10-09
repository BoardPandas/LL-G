---
tech: dom
tags: [async, browser, revision-pair, projection, camera, requestAnimationFrame, race-condition]
severity: high
---
# Post-write UI focus can run before revision-paired view data arrives

## PROBLEM
An accepted draft write can resolve before its asynchronous, revision-paired table projection is fetched and painted. A success callback that immediately tries to focus newly created paper/card IDs reads a null or stale view. If the focus helper treats no matching targets as an empty table, it silently resets the camera to the origin. After repeated sorts, all cards can appear to vanish off-screen even though every write succeeded and the draft is intact. A single fast local run may pass; a delayed table response or repeated browser cycle exposes the race.

## WRONG
```js
const result = await apply(sortOps);
if (result.ok) {
  repaint();
  requestAnimationFrame(() => focusPapers(newPaperIds));
}
// One animation frame does not wait for the matching table request.
```

## RIGHT
```js
let pendingFocusIds = null;
async function sort(sortOps, newPaperIds) {
  const result = await apply(sortOps);
  if (!result.ok) return;
  pendingFocusIds = newPaperIds;
  repaint();
  focusWhenPaired(currentView());
}
function focusWhenPaired(view) {
  if (!pendingFocusIds) return;
  const visibleIds = new Set(view.tableData?.physicalTable?.papers?.map((paper) => paper.id) ?? []);
  if (!pendingFocusIds.every((id) => visibleIds.has(id))) return;
  const ids = pendingFocusIds;
  pendingFocusIds = null;
  requestAnimationFrame(() => focusPapers(ids));
}
// Call focusWhenPaired(view) after every accepted revision-paired table paint.
// If an explicit target is absent, focusPapers preserves the current camera.
```

## NOTES
- The data condition is target IDs in the projection paired to the current draft revision; a timeout, microtask, or animation frame alone is not that condition.
- Test with a deliberately delayed table response and repeated sort/move cycles in a rendered browser. Assert at least one card stays hit-testable and the camera never falls back to origin while the target is pending.
- Distinguish a genuinely empty table (where Home may reset the camera) from an explicit focus request whose targets have not arrived yet.
