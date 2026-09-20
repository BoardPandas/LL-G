---
tech: css
tags: [overflow, accessibility, sr-only, absolute-positioning, tables, responsive, containing-block]
severity: high
---
# Absolutely positioned screen-reader text can escape a scrolling table's clipping

## PROBLEM

A responsive table can have the correct `overflow-x: auto` wrapper, look visually clipped, and still widen the whole document. A visually hidden label such as Tailwind's `sr-only` uses `position: absolute`. If its containing block lives outside the scroll container, the label can escape the ancestor's overflow clipping. Its tiny box still lands at the offscreen column's horizontal position and increases the root scrollable width.

The tell is a wide blank strip beside an otherwise correctly clipped mobile table. Ordinary overflow diagnostics often miss it: they discard every offscreen element with an overflow ancestor, which incorrectly assumes the clipping applies to absolutely positioned descendants too.

Verified in Chromium on a 390px viewport: a table's hidden Actions header increased `document.documentElement.scrollWidth` to 696px. Changing only the scrolling wrapper from `position: static` to `position: relative` returned the document to exactly 390px. Reverting that property reproduced 696px. No visible label or table column changed.

## WRONG

```html
<div class="overflow-x-auto">
  <table>
    <!-- many columns -->
    <th><span class="sr-only">Actions</span></th>
  </table>
</div>
```

```css
/* This clips in-flow table content, but creates no containing block. */
.overflow-x-auto { overflow-x: auto; }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
```

## RIGHT

```html
<div class="relative min-w-0 overflow-x-auto">
  <table>
    <th><span class="sr-only">Actions</span></th>
  </table>
</div>
```

```css
/* Keep positioned descendants in the same clipping/scrolling boundary. */
.table-scroll {
  position: relative;
  min-width: 0;
  overflow-x: auto;
}
```

## NOTES

- Preserve the accessible header. Removing the label hides the symptom while losing its purpose.
- Check root scrollWidth, not just screenshots or the table wrapper's bounding box.
- When overflow remains unexplained, inspect absolutely positioned hidden elements and their containing blocks. Do not discard an offender merely because an ancestor has overflow set.
- Keep wide tables scrollable inside their containers; a blanket body overflow-x:hidden can hide unreachable controls elsewhere.
- This is a CSS rendering lesson, not an agent-configuration defect. Browser layout regression checks are appropriate; no configuration eval case is needed.
