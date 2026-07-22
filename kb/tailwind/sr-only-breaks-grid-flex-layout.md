---
tech: tailwind
tags: [sr-only, accessibility, grid, flexbox, layout, screen-reader, visually-hidden]
severity: high
---
# sr-only on a grid/flex item silently removes the cell and shifts the whole layout

## PROBLEM
`sr-only` is `position: absolute` (plus a 1px clip rect). An absolutely-positioned child is **out of flow**, so it stops being a grid or flex item: it consumes no track and no flex slot.

Applying it directly to a child of a `grid` container therefore means that container has one fewer in-flow item than it has tracks. Every sibling after it slides one column to the left, and the last track renders empty. In flex rows the same thing collapses a gap.

This is a nasty one because nothing catches it:
- TypeScript passes -- it's a class name.
- Tests pass -- jsdom does not compute grid placement.
- ESLint passes -- the class is valid.
- The a11y intent is *correct*, so the code reads as obviously right in review.

It is only visible to a human looking at the rendered page, which means it ships. The classic trigger is a header row for a table-like grid where one narrow column (icon, status dot, checkbox) has no visible heading but should still be announced, so you reach for `sr-only` on the header cell.

Note the trap needs a positioned ancestor to be *visually* obvious, but the layout break happens regardless: out-of-flow is out-of-flow whether or not the abspos element ends up somewhere sensible.

## WRONG
```tsx
// 9 tracks declared...
const QUEUE_GRID = 'grid-cols-[30px_16px_44px_minmax(0,1fr)_130px_124px_92px_130px_60px]'

<div className={`grid items-center gap-3 ${QUEUE_GRID}`}>
  <span aria-hidden />                          {/* checkbox column   */}
  <span className="sr-only">Unread</span>       {/* ...but abspos: NOT a grid item */}
  <SortHeader label="P" />                      {/* lands in track 2, not 3 */}
  <SortHeader label="Subject" />
  {/* ...every heading now sits one column left of its data; last track empty */}
</div>
```

## RIGHT
```tsx
// Keep an in-flow element in the track; nest the visually-hidden text inside it.
<div className={`grid items-center gap-3 ${QUEUE_GRID}`}>
  <span aria-hidden />
  <span>
    <span className="sr-only">Unread</span>     {/* abspos, but its PARENT holds the cell */}
  </span>
  <SortHeader label="P" />
  <SortHeader label="Subject" />
</div>
```

```tsx
// If the column genuinely needs no accessible name, an empty in-flow cell is
// enough -- the point is that SOMETHING in-flow must occupy the track.
<span aria-hidden />
```

## NOTES
- Same failure with any visually-hidden implementation built on `position: absolute`: Bootstrap's `.visually-hidden`, the classic `.sr-only` clip-rect recipe, most hand-rolled versions. It is not a Tailwind bug; Tailwind is just where most people meet it.
- The `clip-path`/`clip` + `w-1 h-1 overflow-hidden` variants that keep `position: static` do not have this problem, but Tailwind's `sr-only` is not one of them.
- Quick diagnosis when a grid's headings are off by one: count in-flow children against declared tracks. In DevTools, an element that vanished from the grid overlay's cell numbering while still being in the DOM is the giveaway.
- Guard it in review, not in CI: typecheck, unit tests, and lint all pass. If the grid is important, a render test that counts cells is the only mechanical protection.
- Related: [Conditional classes with cn()](cn-utility.md) -- another case where a class-level mistake produces no error and a silently wrong render.
