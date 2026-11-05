---
tech: jest
tags: [jsdom, testing-library, drag-and-drop, dragevent, clientx, react]
severity: high
---
# jsdom has no DragEvent, so fireEvent drag events silently drop clientX

## PROBLEM
jsdom does not define `DragEvent`, so Testing Library's `fireEvent.dragOver` / `fireEvent.drop` fall back to a bare `Event` and silently drop `clientX`, `clientY` and every other MouseEvent field.
Any test of position-dependent drag logic (which half of an element a drop lands on) reads `undefined`. `undefined < box.left + box.width / 2` is always false, so the code always takes the "after" branch. Tests for "before" fail for no visible reason, and tests for "after" pass whatever the code does. Nothing warns: `dataTransfer` is still attached, so the event looks complete.

## WRONG
```tsx
// clientX never reaches the handler in jsdom
fireEvent.drop(target, { dataTransfer, clientX: 20 })
expect(onMove).toHaveBeenCalledWith(id, targetId, 'before') // receives 'after'
```

## RIGHT
```tsx
// Before firing any drag events in the test file:
if (typeof window.DragEvent === 'undefined') {
  ;(window as unknown as { DragEvent: unknown }).DragEvent = class extends MouseEvent {}
}
fireEvent.drop(target, { dataTransfer, clientX: 20 }) // clientX now arrives
```

## NOTES
Testing Library still handles the `dataTransfer` init key on its own, so a plain mock object with `setData` / `setDragImage` keeps working. Mock `getBoundingClientRect` on each element too, since jsdom returns all zeros. Related: jest/jsdom-no-textencoder.
