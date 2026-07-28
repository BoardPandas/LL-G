---
tech: tailwind
tags: [shadcn, table, whitespace-nowrap, max-width, line-clamp, overflow, silent-failure]
severity: high
---
# shadcn TableCell's whitespace-nowrap silently defeats max-width, break-words and line-clamp

## PROBLEM

shadcn/ui's `TableCell` ships `whitespace-nowrap` in its base classes
(`"p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0"` in
`components/ui/table.tsx`). `white-space` is an **inherited** CSS property, so
every descendant of the cell inherits nowrap — including any wrapper div or
`<p>` of prose you place inside it.

Long text in a cell therefore renders as one endless line that paints straight
past the table's right edge. The tail is cut mid-word: reachable only by
scrolling sideways if an `overflow-x-auto` wrapper happens to exist, and not
reachable at all if one doesn't. Nothing fails — typecheck, lint and tests all
pass — and the text is typically an error message or other edge-case string
that no one has seen yet, so it ships undetected and first appears in the
incident you most need to read it.

The trap is that all three obvious remedies are no-ops here:

1. **`max-w-*` on the `<td>`** — under `table-layout: auto` a max-width on a
   table cell is *advisory*. The browser sizes columns from content and grows
   past it. Measured in production: a cell carrying `max-w-md` (448px) rendered
   **1117px** wide.
2. **`break-words`** (`overflow-wrap: break-word`) — only acts where wrapping is
   permitted at all. Under nowrap it does nothing.
3. **`line-clamp-*`** — cannot produce multiple lines under nowrap either, so it
   silently clamps to one line instead of the N you asked for.

## WRONG

```tsx
// The cap is ignored (advisory on a <td>), the text never wraps (inherited
// nowrap), and break-words cannot help because wrapping is not permitted.
// Compiles, lints, tests green — and the reason runs off the table.
<TableCell className="max-w-md">
  <StatusBadge value={change.status} />
  {change.errorMessage && (
    <p className="mt-1 break-words text-xs text-muted-foreground">
      {change.errorMessage}
    </p>
  )}
</TableCell>
```

## RIGHT

```tsx
// All three classes are load-bearing, on a BLOCK CHILD, never on the <td>:
//  - whitespace-normal : defeats the inherited nowrap, permitting wrapping at all
//  - max-w-* on the div: a block box's max-width DOES clamp its max-content
//                        contribution, so the column stops growing
//  - break-words       : for text carrying an unbroken token (e.g. a raw JSON
//                        error envelope with no spaces) that wrapping alone
//                        cannot break
<TableCell>
  <div className="max-w-md whitespace-normal">
    <StatusBadge value={change.status} />
    {change.errorMessage && (
      <p className="mt-1 break-words text-xs text-muted-foreground">
        {change.errorMessage}
      </p>
    )}
  </div>
</TableCell>
```

## NOTES

**Comment the classes.** The failure is silent and none of the three looks
load-bearing on its own, so each is a prime candidate for a future "tidy-up"
deletion. Say in a comment that dropping any one re-breaks it.

**`max-w-* truncate` is NOT this bug.** That combination is deliberate
single-line ellipsis and works correctly *because* of the inherited nowrap.
Don't "fix" those cells. (Its cap is still advisory, so the column may be wider
than intended — harmless when content is short, worth knowing when it isn't.)

**Tables with explicit column widths are immune.** A data-grid style table that
sets `style={{ width }}` per cell plus `overflow-hidden` clips at the column
boundary instead of painting past it. Only hand-rolled `<Table>` markup relying
on auto layout is exposed.

**Detection — measure, don't reason.** In the browser:

```js
getComputedStyle(el).whiteSpace          // must be "normal", not "nowrap"
p.scrollWidth <= p.clientWidth           // text fits its box
box.scrollWidth <= box.clientWidth       // table fits its container
document.documentElement.scrollWidth <= document.documentElement.clientWidth
```

**Meta-lesson: verify the deployed DOM before declaring a CSS layout fix done.**
This took three commits in one codebase because the first two diagnoses were
reasoned about rather than measured. Moving the cap to a block child was
*correct but insufficient*, and only the deployed page revealed it: the wrapper
was holding at exactly 448px while the text still ran off, because nowrap — not
the cap — was the real blocker. A partial CSS fix looks identical to a working
one in the diff.

**Audit query.** To find other instances, grep hand-rolled table files for
`max-w-` and `line-clamp-` inside `TableCell`, then subtract the ones paired
with `truncate`. A `line-clamp-*` inside a shadcn `TableCell` is always wrong.
