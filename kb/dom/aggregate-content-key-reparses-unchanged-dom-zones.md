---
tech: dom
tags: [dom, rendering, performance, invalidation, innerhtml]
severity: high
---
# Aggregate content keys can reparse unchanged DOM zones

## PROBLEM

A UI can preserve its outer shell and still make every local state change expensive. If one
serialized content key covers several independently rendered zones, any change authorizes every
zone's `innerHTML` replacement. A one-card move can then parse, allocate and lay out an unchanged
hundred-card sibling.

Correctness tests stay green because the final DOM is accurate. Fast developer machines and warm JIT
paths may also hide the cost. The defect appears only with production-size data, CPU throttling and
main-thread long-task measurements, so a component described as "keyed" can still be the source of
scale-only input latency.

## WRONG

```javascript
const nextKey = JSON.stringify({ incoming, workspace, deck });
const replaceContent = nextKey !== previousKey;

if (replaceContent) {
  incomingBody.innerHTML = renderIncoming(view);
  workspaceBody.innerHTML = renderWorkspace(view);
  deckBody.innerHTML = renderDeck(view);
}
```

## RIGHT

```javascript
const nextKeys = {
  incoming: keyForIncoming(view),
  workspace: keyForWorkspace(view),
  deck: keyForDeck(view),
};
const changed = Object.fromEntries(
  Object.entries(nextKeys).map(([zone, key]) => [zone, previousKeys?.[zone] !== key]),
);

if (changed.incoming) incomingBody.innerHTML = renderIncoming(view);
if (changed.workspace) workspaceBody.innerHTML = renderWorkspace(view);
if (changed.deck) deckBody.innerHTML = renderDeck(view);
```

## NOTES

Keep each key limited to data that affects that surface's markup. Patch stable-shell state such as
counts, collapsed trays and ARIA attributes separately. Reserve a force-all path for explicit
recovery/remount cases. Add isolation tests that change one zone and assert only its key changes,
then retain a production-cardinality browser latency gate as the terminal proof.

