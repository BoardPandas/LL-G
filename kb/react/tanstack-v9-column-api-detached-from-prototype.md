---
tech: react
tags: [tanstack-table, react-table, v9, migration, prototype, this-binding, filters, upgrade]
severity: high
---
# TanStack Table v9 moves column APIs onto a prototype, so passing `column.setFilterValue` by reference detaches it

## PROBLEM

TanStack Table v8 gave each column its own closures, so handing a child component
a bare `column.setFilterValue` reference was correct and idiomatic. v9 assigns
column, row, header and cell APIs onto a **shared prototype** instead, and each
one reads its receiver from `this`:

```js
// table-core v9, utils.js -- assignPrototypeAPIs()
prototype[fnKey] = function (...args) { return fn(this, ...args) };
```

Detach that reference and the call arrives with `this === undefined`, so the
feature's implementation dies on its first property read of the receiver:

```js
// columnFilteringFeature.utils.js
function column_setFilterValue(column, value) {
  table_setColumnFilters(column.table, ...)   // TypeError when column is undefined
}
```

The runtime error is `Cannot read properties of undefined (reading 'table')`.

**The signature did not change between v8 and v9**, so nothing flags it: `tsc`
passes, lint passes, and the whole test suite can pass too (see NOTES). The
upgrade looks complete and lands a runtime-only break. In one app this took out
*every* column filter — text, select, multi-select, boolean and date-range, on
every table — and it was invisible in the UI: the filter popover opened, listed
its options, highlighted on hover, and did nothing at all on click. Three
separate user bug reports ("filters are not selectable on any module") before
anyone connected it to the dependency bump six days earlier.

The trap generalises to all ~85 prototype APIs (`getFilterValue`,
`toggleSorting`, `toggleVisibility`, `getIsPinned`, …) on all four receiver
types — anywhere a column API leaves the component holding the column.

## WRONG

```tsx
function FilterControl({ column, filterMeta }) {
  const value = column.getFilterValue();

  // Detached: the child calls it with no receiver, `this` is undefined,
  // and it throws inside the feature before any filter is applied.
  if (filterMeta.type === "text") {
    return <TextFilter value={value} onChange={column.setFilterValue} />;
  }
  return <SelectFilter value={value} onChange={column.setFilterValue} />;
}
```

## RIGHT

```tsx
function FilterControl({ column, filterMeta }) {
  const value = column.getFilterValue();

  // Called THROUGH the column, so `this` is the column.
  const setFilterValue = React.useCallback(
    (v: unknown) => column.setFilterValue(v),
    [column],
  );

  if (filterMeta.type === "text") {
    return <TextFilter value={value} onChange={setFilterValue} />;
  }
  return <SelectFilter value={value} onChange={setFilterValue} />;
}
```

## NOTES

**Table APIs are the exception, and the asymmetry is the confusing part.**
`assignTableAPIs` writes `table[fnKey] = fn` where `fn` already closes over the
table, so table-level APIs *are* safe to pass by reference:

```tsx
onReorder: table.setColumnOrder   // fine -- bound closure, not a prototype method
column.setFilterValue             // NOT fine -- prototype method, needs its receiver
```

So "it works for `table.x`, therefore it works for `column.x`" is exactly the
wrong inference, and a codebase can contain both patterns with only one broken.

**A unit test with a hand-rolled column stub certifies the bug as working.**
This is the reason the upgrade shipped green. A fake like
`{ getFilterValue: () => v, setFilterValue: spy }` has **own properties**, never
a prototype, so detaching it is harmless and the test passes with the defect in
place. The regression test must pull the column off a real `useTable` instance:

```tsx
const table = useTable({ features, data, columns, ... });
const column = table.getColumn("status");   // prototype-backed -- reproduces the bug
```

**Finding every occurrence.** The API names are enumerable from the package, so
sweep for a reference that is not immediately a call. Do this before declaring a
v9 migration done:

```bash
grep -rhoE "^\s+(column|row|header|cell)_[A-Za-z]+: \{" \
  node_modules/@tanstack/table-core/dist/features/*/*.js \
  | sed -E 's/^\s+//; s/: \{//; s/^(column|row|header|cell)_//' | sort -u \
  | while read -r m; do grep -rnE "\.$m\b\s*[^(a-zA-Z]" src; done
```

Same hazard for any object spread of a column/row/header/cell (`{...column}`)
— the copy has the own properties but loses the prototype, so every API on it
is gone rather than merely unbound.

Related: [`data ?? []` during a query's loading gap hard-freezes the tab](query-loading-gap-empty-array-identity-render-loop.md),
the other TanStack Table gotcha whose symptom is "the grid is dead" with nothing
in the logs.
