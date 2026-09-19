---
tech: tailwind
tags: [tailwind-v4, lightningcss, translate, dialog, css, browser-testing]
severity: high
---
# Reset Tailwind translation utilities when repositioning a centered dialog

## PROBLEM

A centered dialog uses Tailwind v4 translate-x-[-50%] and translate-y-[-50%]. Repositioning it with inset:12px and transform:none leaves the independent CSS translate property active, moving the drawer half its width and height offscreen. Document-overflow checks can still pass because the content is clipped above and left of the viewport.

Adding translate:none beside transform:none can also fail: the Lightning CSS pipeline observed in Next.js 16.3.4 compacted both declarations into transform:none, while the inherited utility still set translate through --tw-translate-x/--tw-translate-y. The source looked fixed but the browser computed translate:-50% -50%.

## WRONG

```tsx
<DialogContent className="drawer" />
```

```css
.drawer {
  inset: 12px !important;
  translate: none !important;
  transform: none !important;
}
/* Observed optimized output: translate declaration removed. */
```

## RIGHT

Reset the utility classes through the component's tailwind-merge className path, removing the inherited percentage utilities. Or use a dialog variant that does not include centered positioning.

```tsx
<DialogContent className="drawer translate-x-0 translate-y-0" />
```

```css
.drawer {
  inset: 12px !important;
  transform: none !important;
}
```

Inspect both the compiled stylesheet and computed browser styles. Assert that an opened drawer's bounding rectangle stays inside the viewport, then check keyboard dismissal and focus return.

## NOTES

A fresh dev restart and entry-stylesheet invalidation did not restore the missing declaration. A direct Lightning CSS transform reproduced the compaction, distinguishing optimization from stale caching or selector specificity. Resetting the utility classes passed browser bounds checks in four themes at 360px and 390px. Do not infer that arbitrary imported CSS edits are generally stale from this symptom.
