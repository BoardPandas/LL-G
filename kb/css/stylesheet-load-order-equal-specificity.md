---
tech: css
tags: [specificity, cascade, load-order, stylesheet, scoping, override]
severity: medium
---
# Stylesheet load order decides equal-specificity wins; scope the selector when you can't rely on it

## PROBLEM
When two rules target the same element at the SAME specificity, the one that appears later in
the cascade wins. If those rules live in separate stylesheets injected at runtime (e.g. two
`ensureCss()` calls), the later-loaded sheet wins -- which is invisible from the markup. A
"restyle" silently does nothing when its override happens to load first and loses to a global
rule at equal specificity. Conversely, an appended fix block at the END of a single sheet does
override earlier same-specificity rules in that sheet.

## WRONG
```css
/* global.css (loaded second by the shell) */
.tcg-eyebrow { color: var(--text-4); } /* faint, fails contrast */
```
```js
// section tries to fix it with an equal-specificity rule in a sheet loaded FIRST
ensureCss("/section.css"); // .tcg-eyebrow { color: var(--text-3) }  <- loses, global loads later
ensureCss("/global.css");
```

## RIGHT
```css
/* Option A: rely on load order deliberately -- append the fix LAST in the later sheet */
/* discover.css is ensureCss'd AFTER cards.css, so this wins on equal specificity */
.dl-eyebrow { color: var(--text-3); }

/* Option B (preferred): don't depend on order -- bump specificity with a scope */
.dl .tcg-eyebrow { color: var(--text-3); } /* (0,2,0) beats global .tcg-eyebrow (0,1,0) always */
```

## NOTES
- If you must depend on load order, make the dependency explicit (control the `ensureCss`
  sequence) and document it -- a future refactor that reorders the loads silently breaks the
  override.
- Safer default: win on specificity, not order. A single extra scoping class (`.dl .x` = 0,2,0
  vs `.x` = 0,1,0) makes the override order-independent without `!important`.
- Verify on the real surface: read `getComputedStyle(el).color` in the deployed page, not just
  the source -- the cascade is what ships, not the file you edited.
