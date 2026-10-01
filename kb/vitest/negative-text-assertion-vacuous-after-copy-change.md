---
tech: vitest
tags: [not-toContain, vacuous-test, copy-change, mutation]
severity: high
---
# A negative text assertion goes vacuous when the text it names changes

## PROBLEM
Tests proved "this short list renders no filter field" with `expect(html).not.toContain("Filter Viewing")`. A copy change made the label read "Filter viewing". One positive assertion failed and was fixed; seven negatives kept passing, and would have kept passing with a filter rendered everywhere, because the string they forbid could no longer be produced. Nothing reports a negative that can no longer fail.

## WRONG
```ts
// after the label was lower-cased, this can never fail
expect(html).not.toContain("Filter Viewing");
```

## RIGHT
```ts
// assert the absence of a structural hook, not of copy
expect(html).not.toContain("data-searchable-select-filter");
// or, if copy must be named, repoint it AND prove it live by forcing the
// forbidden thing to render once and watching this fail
expect(html).not.toContain("Filter viewing");
```

## NOTES
When changing user-facing copy, grep the tests for `not.toContain` / `not.toMatch` on the OLD string as well as for positives.
