---
tech: dom
tags: [spa, scroll-restoration, async, lifecycle, session-storage, dom]
severity: high
---
# Checkpointing an unready route erases a saved scroll target

## PROBLEM

An SPA scroll-restoration controller often sets a destination scrollport to zero while its async
section imports and paints. If the person navigates again before that destination becomes ready, a
generic outgoing checkpoint can persist the prepared zero under the destination's view key. That
silently destroys a valid saved target, so returning later starts at the top even though storage,
route identity, and ordinary navigation tests all appear correct. The failure depends on a fast
second navigation or slow import and is easy to miss in settled-state tests.

## WRONG

```js
function checkpointPort(port) {
  store.set(port.viewKey, port.id, Number(port.element.scrollTop) || 0);
}

function beforeRoute() {
  if (activeKey) checkpoint();
  routeReady = false;
  activeKey = nextKey();
  shellMain.scrollTop = 0;
}
```

## RIGHT

```js
function checkpointPort(port) {
  if (!routeReady || port.restoring || !port.viewKey) return;
  store.set(port.viewKey, port.id, Number(port.element.scrollTop) || 0);
}

function beforeRoute() {
  // A genuinely ready outgoing route is captured before readiness is cleared.
  if (activeKey) checkpoint();
  routeReady = false;
  activeKey = nextKey();
  prepareDestinationAtZeroWithoutSaving();
}
```

## NOTES

Keep a separate transition token so a late import or observer from the superseded route cannot
mark it ready or restore it afterward. Test a route with an existing non-zero target, navigate to it
without completing its mount, immediately navigate elsewhere, and assert the original target is
still stored.
