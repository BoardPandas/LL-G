---
tech: react
tags: [radix, dialog, portal, remount, responsive, inert]
severity: medium
---
# Moving a component into a Radix Dialog at a breakpoint remounts it and loses its state

## PROBLEM
A side panel is inline on a wide page and a slide-over on a narrow one. Rendering `<Panel />` inline in one branch and inside `<Dialog>` in the other gives two places in the React tree, and the Dialog content is portalled, so crossing the breakpoint unmounts and remounts the panel. Everything in local state goes: expanded sections, an unsaved input, a short-lived code the user was reading out. Moving the DOM node into the dialog by hand does not work either: Radix decides "outside click" and focus containment from the React tree, so every click inside the moved node dismisses the dialog.

## WRONG
```tsx
{wide ? <aside><Panel /></aside> : (
  <Dialog open={open} onOpenChange={setOpen}>
    <DialogContent><Panel /></DialogContent>
  </Dialog>
)}
```

## RIGHT
```tsx
// one mount; only the frame changes
<aside
  className={wide ? 'static w-80' : cn('fixed inset-y-0 right-0 w-[min(480px,100%)]', !open && 'hidden')}
  role={wide ? undefined : 'dialog'} aria-modal={wide ? undefined : true} tabIndex={-1}
>
  <Panel />
</aside>
// when it is a sheet and open: set `inert` on everything outside it (but not the
// toast viewport), move focus in, restore it on close, and handle Escape with
// preventDefault so page-level Escape handlers do not also run
```

## NOTES
Keep inactive tabs inside such a panel mounted and hidden rather than letting a Tabs primitive unmount them, for the same reason. If you hand-roll the sheet you own the modality: `inert`, focus restore and Escape are no longer free.
