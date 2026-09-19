---
tech: react
tags: [radix-ui, portals, keyboard, escape, events, navigation]
severity: high
---
# Escape can dismiss a portal and also trigger page navigation

## PROBLEM

A window-level Escape shortcut returns from a detail screen to its list. It
tries to avoid navigating while a menu or dialog is open by querying the DOM.
A portal-based overlay can handle Escape and unmount before the event reaches
that window listener. The DOM query then finds no open overlay, so the same
keypress dismisses the menu and unexpectedly navigates away from the record.

This occurred while replacing an application tab-overflow menu with Radix
DropdownMenu. The menu dismissed correctly and the keyboard event then reached
the ticket's return-to-queue shortcut. Type checking, builds and layout tests
all passed; a browser interaction test exposed the unintended navigation.

## WRONG

```tsx
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]')) return;
  router.push('/tickets');
}
```

The absence of an overlay at the time of the window listener does not prove
that this event originated on the page or has not already been consumed.

## RIGHT

```tsx
function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  const target = event.target;
  if (target instanceof HTMLElement &&
      target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]')) return;
  if (document.querySelector('[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper]')) return;
  router.push('/tickets');
}
```

Respect consumed events and inspect their original target in addition to any
currently mounted overlay. A detached target can still retain its menu/dialog
ancestors. For shadow-DOM components, consider the event's composed path as
well. Preserve typing-target and modifier-key guards in the shortcut helper.

## NOTES

- Keep overlay focus management in the established dialog/menu primitive.
- Test with a real portal: open it, press Escape, assert it closes and the detail
  URL remains unchanged. Press Escape on the page separately and assert normal
  back-navigation still works.
- A regression unit test can also dispatch a prevented event and an event whose
  target belongs to a detached menu, and assert navigation is not called.
- This is an event-ordering issue, not a reason to add a timeout to navigation.
