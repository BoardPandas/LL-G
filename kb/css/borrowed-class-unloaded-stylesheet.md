---
tech: css
tags: [code-splitting, stylesheet-loading, utility-class, design-system, silent-failure, class-naming, refactoring]
severity: high
---
# A utility class only exists on the pages whose stylesheet defines it

## PROBLEM

When stylesheets are code-split per route/section and injected on demand (`ensureCss()`,
a bundler's per-route CSS chunk, a lazily-imported component sheet), a class name is only
live on the pages that happen to load its defining sheet. Reuse it anywhere else and it
resolves to **nothing at all** -- not a conflict, not a fallback, just an absent rule.

This is invisible in every place you would look for it:

- The markup is right there and reads correctly (`class="sm-foot pf-mono"`).
- `grep pf-mono` finds a definition, so the class looks defined.
- No console error, no build error, no lint rule. Stylelint has nothing for this.
- The element still renders -- it just inherits, so it looks *plausible* rather than
  broken. A mono class dropping to the body sans face is not something you notice unless
  you already suspect it.

It arrives two ways, and the second is worse:

1. **Borrowing.** Someone reuses a handy utility from another section's sheet.
2. **A rename that outran its call sites.** Rules get promoted to a shared sheet and
   renamed (`.dk-confirm-*` -> `.tcg-confirm-*`); one caller is missed and silently loses
   its styling from then on. The commit that moved them usually leaves a comment saying
   so, which nobody reads again.

## WRONG

```css
/* sections/profile/profile.css -- loaded ONLY on /profile */
.pf-mono { font-family: var(--font-mono); }
```

```js
// sections/simulations/render-board.js -- /simulations never loads profile.css,
// so `pf-mono` resolves to nothing and this renders in the body sans face.
`<p class="sm-foot pf-mono">All ${total} rated decks loaded</p>`
```

## RIGHT

```css
/* Option A -- the section declares what it needs, in its OWN sheet. */
.sm-foot {
	font-family: var(--font-mono);   /* not borrowed: pf-mono lives in a sheet
	                                    /simulations never loads */
}
```

```css
/* Option B -- genuinely shared? Move it to a sheet loaded on EVERY route, and
   rename it out of the owning section's namespace. A class prefixed for section A
   sitting in a global sheet is exactly what invites the next borrow. */
/* shared/primitives.css */
.tcg-md-list { margin: 4px 0 8px; padding-left: 18px; }
```

## NOTES

**Audit it mechanically -- eyeballing does not scale.** For each JS/TS file, resolve its
transitive import graph to the set of stylesheets that can actually load for it, extract
every literal class it writes, and flag any class whose only definition sits outside that
set. A second pass -- classes with no rule in *any* sheet -- catches renames that outran
their call sites.

**Two false positives will dominate that report; check both before editing.**

- **Shared JS does not imply shared markup.** A controller in `shared/` toggling
  `.cb-art-fade` looks like a cross-section borrow, but if the `.cb-*` markup is only ever
  emitted by one section's renderers, that section's sheet is always present. Ask where the
  *element* is created, not where the code lives.
- **Some modules inject their own `<style>` at runtime.** A scanner reading only `.css`
  files reports their classes as undefined. Grep the JS for the class too.

**Separate "no rule" from "no rule needed."** Most undefined classes are `querySelector`
handles or extension points sitting beside a real design-system class
(`class="tcg-railhead pr-railhead"`) and are inert by design. The ones that matter are
those carrying appearance: a modifier of an existing component
(`tcg-btn-primary` where the system defines `.tcg-btn.primary` -- the button silently
renders as secondary), or a whole family orphaned together (`-title`/`-msg`/`-foot`) whose
complete set of suffixes exists under one other prefix. That last shape is the signature
of a rename-and-abandon.

**Cheapest prevention:** when a shared module emits a class, its rule belongs in a sheet
that loads wherever that module can run -- and it should carry that sheet's prefix, not the
section it was born in. Scoping the rule to an ancestor the other callers don't have
(`.as-ai-text .as-list`) fails the same way even once the sheet does load.

Related: `stylesheet-load-order-equal-specificity.md` covers which rule wins when two
sheets ARE loaded; this entry is the case where one of them never arrives.
