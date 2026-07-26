---
tech: accessibility
tags: [aria-modal, dialog, inert, focus-trap, keyboard, screen-reader, modal, refcount]
severity: high
---
# `aria-modal="true"` is a promise your code must keep, and a Tab trap does not keep it

## PROBLEM

`aria-modal="true"` changes NO behaviour. It is a pure declaration to assistive
tech that everything outside this dialog is unreachable. The browser does not
enforce it, does not warn, and renders identically with or without it.

So it is trivially easy to ship a dialog that lies. Add `role="dialog"` +
`aria-modal="true"` to a scrim overlay, which is what every tutorial shows, and
you have told a screen reader the page behind is inert while Tab still walks
straight out of the dialog into it. The background is still rendered, still
focusable, still clickable, and now the user is operating it from behind a
scrim they cannot see past. A mouse user never notices, so it survives review
indefinitely.

**The non-obvious half: the "obvious" fix does not fix it.** The usual remedy is
a JS Tab trap -- a keydown handler that cycles focus between the first and last
focusable element in the dialog. That handles Tab and Shift+Tab, so it looks
complete. It does not make `aria-modal` true. A screen reader's virtual cursor
(VO+arrow, NVDA browse mode) does not move by Tab at all; it walks the
accessibility tree. Background content is still in that tree, so the user can
still read and activate it. You have fixed the keyboard symptom and left the
declared contract broken.

Use `inert` on the background instead. It removes the subtree from the tab order
AND the accessibility tree, which is exactly what the attribute claims, and it
covers Shift+Tab and screen-reader navigation for free. It also cannot be
defeated by a component that calls `stopPropagation()` on keydown for its own
arrow-key handling -- a real problem for JS traps in pickers and command
palettes.

Real case: an app had ~48 `aria-modal` surfaces. Two shared primitives did it
correctly with `inert`; a third and fourth had a hand-rolled Tab trap duplicated
between them; the remaining ~10 hand-rolled dialogs enforced nothing at all. The
blanket assumption in either direction ("they're all fine" / "none of them are")
was wrong -- it has to be checked per surface.

## WRONG

```js
// Declares the background inert. Nothing makes it so.
scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">…</div>`;
document.body.appendChild(scrim);
```

```js
// Better, still not what aria-modal claims: Tab is trapped, the accessibility
// tree is not. A screen reader still browses the page behind the scrim.
dialog.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const nodes = dialog.querySelectorAll(FOCUSABLE);
  if (e.shiftKey && document.activeElement === nodes[0]) {
    e.preventDefault(); nodes[nodes.length - 1].focus();
  } else if (!e.shiftKey && document.activeElement === nodes[nodes.length - 1]) {
    e.preventDefault(); nodes[0].focus();
  }
});
```

## RIGHT

```js
// The dialog must live OUTSIDE the container being inerted (append to
// document.body), or it inerts itself.
let depth = 0;                                   // overlays stack; see NOTES

export function trapFocus(dialog, { initialFocus = true, restoreTo = null } = {}) {
  depth += 1;
  const app = document.getElementById("app");
  if (app) app.inert = true;

  if (initialFocus !== false) {
    const target = initialFocus instanceof HTMLElement
      ? initialFocus
      : firstFocusable(dialog) || dialog;
    // rAF: an unpainted node has no client rects, so a visibility filter would
    // reject every candidate.
    requestAnimationFrame(() => target?.focus?.({ preventScroll: true }));
  }

  let released = false;
  return function release() {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0 && !otherOverlayOpen()) {
      const el = document.getElementById("app");
      if (el) el.inert = false;
    }
    if (restoreTo && document.contains(restoreTo)) restoreTo.focus({ preventScroll: true });
  };
}
```

Audit what you already have, rather than assuming:

```bash
# Every surface that makes the promise...
grep -rn 'aria-modal' --include=*.js src | wc -l
# ...versus every one that keeps it. The gap is your finding.
grep -rln '\.inert\s*=\|trapFocus\|inert>' --include=*.js src
```

## NOTES

- **Refcount, or stacked overlays un-trap each other.** A confirm opens over a
  drawer; the confirm closes and sets `inert = false`; the drawer is now open
  with a live background. Any shared helper must count depth, and must also
  defer to overlays that set the flag directly rather than through the helper.
- **`restoreTo` should be opt-in.** Well-built drawer/sheet primitives usually
  already capture a trigger and restore focus to it on close. A helper that
  also restores means two restorers fighting over the same close.
- **Let the caller choose the initial focus.** A destructive confirm should open
  on Cancel, not on the first focusable. A trap that unconditionally grabs
  `firstFocusable` silently undoes that decision.
- **Filter the focusable query by rendered-ness.** `getClientRects().length > 0`
  is the reliable test (empty for `display:none` and for a `hidden` ancestor,
  and unlike `offsetParent` it stays correct for `position: fixed`). Dialogs that
  toggle `hidden` panels will otherwise park focus on an invisible control.
- **Add a force-release valve if dialogs can outlive their opener.** If a router
  does not tear body-appended modals down, a leaked trap leaves the background
  permanently inert -- an app with nothing focusable anywhere. That turns a
  cosmetic stuck-overlay bug into a lockout. A `releaseAll()` called on
  navigation degrades it back to cosmetic.
- **`inert` support** is Chrome 102+, Safari 15.5+, Firefox 112+. Below that it
  is a no-op, so a JS Tab trap remains a reasonable progressive-enhancement
  fallback -- just do not mistake it for equivalence.
