---
tech: tailwind
tags: [rem, font-size, html, root, touch-target, ios-safari, input-zoom, accessibility, spacing]
severity: medium
---
# Setting the base font size on html shrinks every rem-based length

## PROBLEM
To get denser text, the base font size is set on the root element (`html { font-size: 14px }`). Tailwind's spacing, sizing and type scales are all in `rem`, and `rem` is the root font size, so **every** rem-based length shrinks with it, not only text:

- A `h-11` / `min-h-11` touch target (2.75rem) is 44px at the browser default and **38.5px** at a 14px root, below the 44px minimum.
- Form inputs styled `text-base` (1rem) fall under **16px**, the size at which iOS Safari stops zooming the page when an input is focused. The page now zooms on every tap into a field.

Nothing fails to build, and the layout looks proportionally the same, so it is easy to miss.

## WRONG
```css
html { font-size: 14px; }        /* every rem in the design system is now 12.5% smaller */
```

## RIGHT
```css
/* Leave the root at the browser default (which also respects the user's own setting). */
body { font-size: 0.875rem; }    /* set the body text size instead */
```

## NOTES
- Check computed sizes, not class names: measure a touch target and an input's font size in the browser at a phone viewport.
- Components that need a specific text size should set it themselves rather than inherit a shrunken root.
