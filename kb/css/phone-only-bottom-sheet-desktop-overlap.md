---
tech: css
tags: [responsive-css, bottom-sheet, desktop, overlay, fixed-positioning, visual-regression]
severity: medium
---
# A phone-only bottom sheet can pass containment checks while breaking desktop overlays

## PROBLEM
A mobile-only full-width bottom-sheet primitive can be opened unconditionally at desktop widths and still pass viewport-containment and horizontal-overflow checks. The result is an oversized desktop form, and a fixed bottom-bar control may overlap its actions because overlay-placement code intentionally refuses to clear a full-width surface when doing so would collapse the usable bar.

## WRONG
```css
/* Opened at every width even though this is a phone surface. */
.feature-sheet {
  width: 100%;
  max-height: 70dvh;
}
```

## RIGHT
```css
/* Mobile keeps the bottom-sheet default. */

/* --bp-lg: desktop becomes the established right-side editor. */
@media (min-width: 1024px) {
  .feature-sheet {
    width: min(calc(480px / var(--ui-scale, 1)), calc(100vw / var(--ui-scale, 1)));
    height: calc(100dvh / var(--ui-scale, 1));
    margin-left: auto;
    transform: translateX(100%);
  }
}
```

## NOTES
Keep the adaptive surface in the shared overlay selector and ask the shared positioning owner to remeasure on both mount and removal; do not add a second per-control offset. A browser regression must assert the relationship between the desktop panel edge and the floating control, not merely that each rectangle is inside the viewport. Preserve phone-only gestures such as drag-to-dismiss behind the same desktop breakpoint.

