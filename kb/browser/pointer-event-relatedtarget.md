---
tech: browser
tags: [pointer-events, event-handling, chromium, dismissal-timer, edge-case]
severity: medium
---
# Pointer event handoff between trigger and popup requires explicit handling

## PROBLEM
When moving a pointer from a card into a reference popup, cancelling the hide timer on `pointerenter` is insufficient. Chromium delivers a compatibility `mouseout` event after the pointer movement and schedules a new hide, even though the cursor is over the popup. The `relatedTarget` of that `mouseout` is inside the popup, but the old code checked for dismiss without checking the related target. The popup dismisses despite the pointer being over it.

## WRONG
```typescript
// Card element
card.addEventListener('pointerenter', () => {
  clearTimeout(hideTimer);
  showPopup();
});

card.addEventListener('pointerleave', () => {
  hideTimer = setTimeout(() => popup.hidden = true, 200);
});

// Popup element
popup.addEventListener('pointerenter', () => {
  clearTimeout(hideTimer);
});

popup.addEventListener('pointerleave', () => {
  hideTimer = setTimeout(() => popup.hidden = true, 200);
});

// On pointer move from card to popup: mouseout fires on card,
// hideTimer is set, popup dismisses while cursor is inside it
```

## RIGHT
```typescript
const isPointerOverPopup = (event: PointerEvent) => {
  return event.relatedTarget instanceof Node && 
         popup.contains(event.relatedTarget as Node);
};

card.addEventListener('pointerenter', () => {
  clearTimeout(hideTimer);
  showPopup();
});

card.addEventListener('pointerleave', (event) => {
  // Only hide if pointer is NOT moving into the popup
  if (!isPointerOverPopup(event)) {
    hideTimer = setTimeout(() => popup.hidden = true, 200);
  } else {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => popup.hidden = true, 200);
  }
});

popup.addEventListener('pointerenter', () => {
  clearTimeout(hideTimer);
});

popup.addEventListener('pointerleave', (event) => {
  // Only hide if pointer is NOT moving into the card
  if (!event.relatedTarget || !card.contains(event.relatedTarget as Node)) {
    hideTimer = setTimeout(() => popup.hidden = true, 200);
  }
});

// Test with a real browser and shared popup modules, not isolated fixtures
```

## NOTES
Chromium delivers compatibility mouse events after pointer events. A pointer moving from element A to element B triggers:
1. `pointerleave` on A (with `relatedTarget` = B)
2. `mouseout` on A (compatibility event, also with `relatedTarget` = B)

Dismissal logic must check `relatedTarget` to know if the pointer is entering a related element or truly leaving. Fixtures that don't model the actual browser event sequence (pointer + compatibility mouse event with correct targets) miss this bug. Test the interaction with a real browser module and a real popup, not a generic fixture.
