---
tech: css
tags: [zoom, ui-scale, touch-targets, accessibility, mobile-first, media-query, viewport-units, where-specificity, design-tokens]
severity: high
---
# A global `zoom` scale is usually MEDIA-GATED, so phone CSS is in real pixels

## PROBLEM

An app-wide density knob like `body { zoom: var(--ui-scale) }` is almost never
applied unconditionally. It is opted into at a desktop breakpoint, because
scaling a phone up would eat the little viewport width it has:

```css
:root { --ui-scale: 1; }                              /* the real phone value */
@media (min-width: 768px) and (min-height: 500px) {
  :root { --ui-scale: 1.204; }                        /* desktop only */
}
```

The trap is that the token's *documentation* says otherwise. Design-system docs
and rule files routinely describe it as "the whole app renders through
`body { zoom: var(--ui-scale) }` (default 1.204)" -- quoting the desktop value
as if it were the default. Read that and you conclude every declared px is
inflated ~20% at paint. On a phone it is not: `--ui-scale` is `1`, so a
phone-scoped rule paints at exactly its declared size.

Where this bites hardest is **touch targets**, because phone-only chrome is
precisely the code that is both (a) written inside a `max-width` block, so it
never sees the desktop scale, and (b) the code where the 44px minimum actually
matters. A reviewer reasons "40px x 1.204 is ~48px, that clears 44, fine" and
signs off on a genuine WCAG/HIG violation. The arithmetic is right; the premise
is wrong. Nothing renders incorrectly enough to notice, so it ships.

Real case: a floating phone dock's search field and action button were 40px.
Two independent "it's already handled" arguments were both false -- the zoom
does not apply below the breakpoint, and the `@media (pointer: coarse)` safety
net that appeared to enforce 44px was written with `:where()` and lost the
cascade (see NOTES). The controls had been 40px in production the whole time.

## WRONG

```css
/* Reasoning: "everything is zoomed 1.204x, so 40px paints ~48px. Fine." */
@media (max-width: 1023.98px) {
  .dock-action {            /* phone-only: --ui-scale is 1 here, NOT 1.204 */
    width: 40px;            /* paints at 40 REAL px -> under the 44px minimum */
    height: 40px;
  }
}

/* Same mistake, opposite direction: dividing a viewport unit that is never
   scaled on this platform, so the element is short by ~17% on phones. */
@media (max-width: 1023.98px) {
  .sheet { max-height: calc(88dvh / var(--ui-scale, 1)); }  /* /1 on phone: ok
                                                               by luck, but the
                                                               author's model is
                                                               wrong */
}
```

## RIGHT

```css
/* Check where the scale is actually SET before reasoning about any size. */
/*   grep -n "ui-scale" tokens.css   ->  is the 1.204 inside a @media?        */

@media (max-width: 1023.98px) {
  /* Phone-scoped: --ui-scale is 1, so declared px == painted px.
     Write the real minimum; do not budget for a zoom that never arrives. */
  .dock-action {
    width: 44px;
    height: 44px;
    min-height: 44px;
  }
}

/* Viewport units still need the divide, but only where the scale is LIVE.
   Inside a desktop-gated block the division is load-bearing; inside a
   phone-only block it is a no-op that documents intent. Keep it either way --
   it is correct in both, and a block's breakpoint can change later. */
height: calc(100dvh / var(--ui-scale, 1));
```

Verify against the painted box rather than the source, on a real coarse-pointer
viewport:

```js
// DevTools, 375x667. getBoundingClientRect() reports POST-zoom CSS pixels.
const r = document.querySelector('.dock-action').getBoundingClientRect();
console.log(r.width, r.height, getComputedStyle(document.documentElement)
  .getPropertyValue('--ui-scale'));   // expect 44 44 " 1" on a phone
```

## NOTES

- **Read the token, not the prose about the token.** The single highest-value
  check is `grep -n "ui-scale" tokens.css` to see whether the non-1 value sits
  inside a `@media`. Design-system READMEs and path-scoped rule docs drift and
  quote the desktop value as the default; the stylesheet cannot.
- **`zoom` scales raw viewport units too** (`dvh`/`svh`/`lvh`/`vh`/`vw`/`vmin`/
  `vmax`), which is why codebases that use it grow a `calc(100dvh / var(--ui-scale))`
  convention. Percentages, flex, and `auto` resolve against the already-zoomed
  box and must NOT be divided. Media queries evaluate against the real viewport
  and are unaffected, which is what lets the gate work at all.
- **A landscape phone must not be treated as a tablet.** A width-only gate
  (`min-width: 768px`) scales 844x390 and 896x414 phones up like tablets,
  shrinking layout space exactly where it is scarcest. Pair it with a
  `min-height` term. Watch for the same guard being spelled with two different
  height thresholds in different files -- document the divergence rather than
  "unifying" it blind, since the two gate different things.
- **Compounding trap: the `@media (pointer: coarse)` net that appears to floor
  touch targets is usually written with `:where()` and enforces nothing.** Full
  writeup: [`:where()` contributes ZERO specificity, so a rule written with it
  guarantees nothing](where-zero-specificity-guarantees-nothing.md). Check the
  guard before citing it as the reason a small target is acceptable.
- **Both halves of this failure are "already handled" claims.** When a size
  looks too small and someone explains why it is secretly fine, measure the
  rendered box before accepting the explanation. Two plausible mitigations were
  each individually convincing and both wrong.
