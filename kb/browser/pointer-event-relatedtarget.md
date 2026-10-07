---
tech: browser
tags: [pointer-events, event-handling, chromium, dismissal-timer, edge-case]
severity: medium
---
# Pointer event handoff between trigger and popup requires explicit handling

## PROBLEM
Chromium delivers compatibility `mouseout` after pointerleave. A dismissal timer set on the old code schedules hide even though cursor is over the popup, because it doesn't check `relatedTarget`.

## WRONG
```typescript
card.addEventListener('pointerleave', () => {
  hideTimer = setTimeout(() => popup.hidden = true, 200);
});

// On pointer move to popup: mouseout fires, hideTimer set,
// popup dismisses while cursor inside it
```

## RIGHT
```typescript
card.addEventListener('pointerleave', (event) => {
  const inPopup = event.relatedTarget instanceof Node && 
                  popup.contains(event.relatedTarget);
  if (!inPopup) {
    hideTimer = setTimeout(() => popup.hidden = true, 200);
  }
});
```

## NOTES
Dismissal logic must check `relatedTarget` to know if pointer entered a related element. Test with a real browser and actual popup module, not generic fixtures.
