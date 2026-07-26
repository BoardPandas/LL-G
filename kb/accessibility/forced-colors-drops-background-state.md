---
tech: accessibility
tags: [forced-colors, high-contrast, windows, prefers-contrast, background-color, focus, status, css]
severity: medium
---
# Windows High Contrast drops your backgrounds, so any state carried by a tint vanishes

## PROBLEM

In `forced-colors: active` (Windows High Contrast and its equivalents) the OS
overrides the page's palette with the user's own and **discards background
colours on most elements**. Text and borders get remapped to system colours;
background fills largely do not survive.

Modern dark UIs lean on background tint as the primary state signal, because on
a dark surface a subtle fill reads better than a border. The active nav row is a
slightly lighter surface. The selected card is a tinted overlay. Focus is an
accent ring. Status pills are a low-alpha fill plus a low-alpha border. Every one
of those is invisible in forced-colors: not restyled, *gone*. The user cannot
tell which nav item is active, which cards are selected, or where focus is.

It is silent in the strongest sense: nothing errors, no automated checker in a
normal run flags it, and it is invisible to anyone not actually running High
Contrast. A codebase can go years with zero `forced-colors` rules and no report,
because the affected users bounce rather than file.

The instinct on discovering this is to restore the colours. That is backwards --
the user deliberately chose their palette. Re-express each state with a property
forced-colors *keeps*: a border, an outline, or a system colour keyword
(`Highlight`, `CanvasText`, `ButtonText`, `LinkText`).

Scrims are a second, sharper trap. A `rgba(0,0,0,.6)` overlay is a background,
and in forced-colors it commonly paints as a solid opaque block -- so the modal
you were showing is now behind a wall of flat colour.

## WRONG

```css
/* Every one of these states is background-only. All invisible in High Contrast. */
.navlink.active   { background: var(--bg-elev-2); color: var(--text); }
.tile.selected    { background: var(--accent-soft); }
.pill.danger      { color: var(--danger);
                    background: oklch(.72 .18 25 / .1);
                    border-color: oklch(.72 .18 25 / .25); }  /* alpha border also drops */
:focus-visible    { box-shadow: 0 0 0 3px var(--accent-soft); } /* shadows are dropped too */
.modal-scrim      { background: rgba(0,0,0,.6); }               /* paints as an opaque block */
```

## RIGHT

```css
@media (forced-colors: active) {
  /* Focus must never be background- or shadow-only. */
  :focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }

  /* Re-state selection/active with geometry the mode preserves. */
  .navlink.active { border-left: 3px solid Highlight; color: Highlight; }
  .tile.selected,
  [aria-selected="true"],
  [aria-current="page"] { outline: 2px solid Highlight; outline-offset: -2px; }

  /* A real (non-alpha) border, so each pill still has an edge. */
  .pill, .pill.success, .pill.warn, .pill.danger, .pill.info,
  .btn, .btn.primary, .btn.danger { border: 1px solid currentColor; }

  /* Drop scrims; let the dialog's own border carry the separation. */
  .modal-scrim, .sheet-scrim { background: transparent; }
  .modal, .sheet, .drawer    { border: 1px solid CanvasText; }

  /* Shimmer conveys nothing here and reads as a flashing block. */
  [class*="-skel"] { animation: none; }
}
```

Test it for real, not by reading CSS:
- **Chrome/Edge DevTools** -> Rendering pane -> *Emulate CSS media feature
  forced-colors: active*.
- Then tab through and ask the only question that matters: can I still see
  which item is active, which are selected, and where focus is?

## NOTES

- **`forced-colors` and `prefers-contrast` are different things.**
  `forced-colors: active` means the OS is substituting a palette.
  `prefers-contrast: more` means the user wants higher contrast within YOUR
  palette. Handling one does not handle the other; most apps that support
  neither should start with `forced-colors`, which is the one that breaks
  states outright.
- **Never use `forced-colors-adjust: none` to "fix" this.** It opts an element
  out of the user's palette entirely and defeats the feature. It is defensible
  only for things that are inherently colour-as-content -- a colour picker
  swatch, a brand mana pip whose hue IS the information.
- **`box-shadow` and `background-image` are dropped too.** Any focus ring built
  from `box-shadow` (a very common token pattern) disappears; `outline` is the
  property that survives. This is a good reason to define focus with `outline`
  in the first place.
- **Keep it in ONE block.** The set of states that must survive High Contrast is
  exactly the set of states carried by background, shadow, or alpha border --
  worth being able to read in one place and re-audit when a new state is added.
- **Grep as a first pass, then look:** rules matching
  `\.(active|selected|current|open)\b` whose only declaration is `background`
  are the candidate list.
