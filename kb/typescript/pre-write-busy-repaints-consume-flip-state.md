---
tech: typescript
tags: [flip, animation, state-management, repaint, performance, reduced-motion]
severity: high
---
# Pre-write busy repaints can consume FLIP state

## PROBLEM
A state store may notify subscribers with a content-identical busy state before it publishes the changed document. If every subscriber paint consumes the pending FLIP measurement, that unchanged repaint clears the ticket and the real changed paint has nothing to animate. A simplified fixture that jumps directly to the changed document still passes, so the production animation silently disappears while unit and browser tests look green.

## WRONG
```typescript
let before: Map<string, DOMRect> | null = null;

function prepareWrite() {
  before = measureCards();
}

function paint(state: State) {
  renderPile(state);
  if (!before) return;
  animateFlip(before, measureCards());
  before = null;
}
```

## RIGHT
```typescript
type PaintMarker = { id: string; rev: number } | { doc: DraftDocument };

let pending: { marker: PaintMarker; before: Map<string, DOMRect> | null } | null = null;

function prepareWrite(state: State) {
  pending = {
    marker: markerFor(state.draft),
    before: prefersReducedMotion() ? null : measureCards(),
  };
}

function paint(state: State) {
  if (pending && sameDraft(pending.marker, state.draft)) {
    paintBusyChrome(state);
    return;
  }

  renderPile(state);
  const ticket = pending;
  pending = null;
  if (ticket?.before) animateFlip(ticket.before, measureCards());
}
```

## NOTES
Test the real notification order: the same saved id/revision or local document object with busy set, followed by the changed draft. Keep the ticket through the first notification, consume it exactly once on the changed document, and perform no animation-only geometry work under reduced motion.
