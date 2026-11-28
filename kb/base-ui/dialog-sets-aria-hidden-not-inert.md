---
tech: base-ui
tags: [dialog, modal, aria-hidden, inert, accessibility, testing, focus]
severity: medium
---
# Base UI's Dialog sets aria-hidden on the rest of the page, not inert

## PROBLEM
When a modal Base UI Dialog is open, the content outside it is marked `aria-hidden`; it is **not** given the `inert` attribute. Code or tests that assume `inert` are wrong in both directions:

- A test asserting that the background has `inert` (or that it does not have `aria-hidden`) fails.
- Queries by role, such as Testing Library's `getByRole`, skip `aria-hidden` content by default, so elements behind the dialog "disappear" from a test even though they are still in the DOM.
- `aria-hidden` hides content from assistive technology only. It does not by itself stop pointer or keyboard interaction; that is the dialog's own job.

## WRONG
```tsx
await user.click(screen.getByRole("button", { name: "Delete" }));        // opens the dialog
expect(document.querySelector("main")).toHaveAttribute("inert");          // fails: it is aria-hidden
expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();    // throws: hidden from role queries
```

## RIGHT
```tsx
await user.click(screen.getByRole("button", { name: "Delete" }));
const dialog = screen.getByRole("dialog");
expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeVisible();   // query inside the dialog
// To reach background elements while the dialog is open:
screen.getByRole("button", { name: "Delete", hidden: true });
```

## NOTES
- Related: `kb/accessibility/aria-modal-needs-inert-not-tab-trap.md` on what a modal must guarantee about the background.
