---
tech: css
tags: [where, is, specificity, cascade, touch-targets, accessibility, guard-rules, resets, not, has]
severity: high
---
# `:where()` contributes ZERO specificity, so a rule written with it guarantees nothing

## PROBLEM

`:where()` always has specificity `(0,0,0)`, no matter what is inside it. Only
the rest of the compound selector counts. That is the entire point of the
construct -- it exists so a reset or a default can be overridden without an
arms race.

The bug is reaching for it when you want the opposite: a **floor**, a
**guarantee**, a safety net that must hold. Written that way the rule looks
authoritative, is syntactically perfect, and silently loses to literally any
class rule that touches the same property:

```css
@media (pointer: coarse) {
  :where(button, a[href], [role="button"], .tab) { min-height: 44px; }
}
```

That reads as "every interactive element is at least 44px on touch." It is
not. The whole selector sits at `(0,0,1)` -- just the element name -- so
`.dock-action { height: 40px }` at `(0,1,0)` wins. The rule is a floor **only
for elements no other rule sizes**, which in a real design system means almost
nothing. Every actual component has its own class.

It is a false green of the same family as an unexecutable git hook: the
protection is present in the source, greppable, reviewable, and inert. Worse,
the intent is legible enough that a reviewer reads the selector, sees the
elements listed, and marks the concern handled without checking the cascade.

`:where()` also looks nearly identical to `:is()`, which behaves the OPPOSITE
way (it takes the specificity of its most specific argument). One character of
difference flips a guarantee into a suggestion.

Real case: a phone dock's action button was 40px. The `:where()` block above was
cited as proof the 44px minimum was already enforced. It had never applied to
that button, or to any other classed control, since the day it was written.

## WRONG

```css
/* Intent: a hard accessibility floor. Effect: applies to nothing that matters. */
@media (pointer: coarse) {
  :where(button, a[href], [role="button"], .tcg-btn, .tab) {
    min-height: 44px;              /* (0,0,1) -- loses to every class rule */
  }
  :where(input, select, textarea) {
    font-size: 16px;               /* same problem: iOS focus-zoom still fires */
  }
}

.dock-action { height: 40px; }     /* (0,1,0) -- wins, silently */
```

## RIGHT

```css
/* A GUARANTEE must out-specify what it guards. Use a real selector list; each
   compound carries its own weight, and the class list beats a bare element. */
@media (pointer: coarse) {
  button, a[href], [role="button"], .tcg-btn, .tab {
    min-height: 44px;              /* (0,1,0) for the class arms */
  }
}

/* Or scope it, which also documents where the rule is authoritative: */
@media (pointer: coarse) {
  .app :is(button, a[href], [role="button"]) { min-height: 44px; }
}
```

`:where()` is exactly right for the inverse case -- a reset that MUST lose:

```css
/* Component classes are applied to both <a> and <button>. Neutralise the UA
   button chrome, but let every existing class rule keep winning:
   .tcg-search keeps its own background, .rail-item keeps width:36px. */
button:where(.tcg-navlink, .tcg-search, .rail-item) {
  appearance: none;
  width: 100%;
  background: none;
  border: 0;
  font: inherit;
}
```

Audit an existing `:where()` guard before trusting it -- check the property on
the elements it claims to cover, not the source:

```js
// Every element the guard names, whose PAINTED size violates the claim.
[...document.querySelectorAll('button, a[href], [role="button"], .tcg-btn, .tab')]
  .filter(el => el.getBoundingClientRect().height < 44)
  .forEach(el => console.warn(el.className || el.tagName,
                              el.getBoundingClientRect().height));
```

## NOTES

- **The decision rule is one question: should this rule WIN or LOSE?**
  Losing on purpose (UA resets, opinionated defaults, base styles a component
  may override) -> `:where()`. Winning on purpose (accessibility minimums,
  safety fallbacks, anything described as "enforced" or "guaranteed") -> never
  `:where()`. Both uses can legitimately appear in the same stylesheet; the
  construct is not the bug, the intent mismatch is.
- **`:is()` is not a drop-in swap for `:where()`.** `:is()` takes the
  specificity of its *most specific* argument, so `:is(button, #foo)` is
  `(1,0,0)` for BOTH arms -- an id in the list silently inflates the whole
  selector. A plain comma-separated list gives each compound its own honest
  weight and is usually what you want for a guard.
- **`:not()` and `:has()` DO contribute specificity from their arguments**, so
  they do not have this problem: `:not(.dot)` is `(0,1,0)`. Only `:where()`
  zeroes its contents. Mixed selectors like
  `:where(.a, .b):not(:has(.dot))::before` therefore land at `(0,1,1)`, not
  `(0,0,1)` -- the `:where()` part is free but the `:not()` part is not.
- **Grep for the word, then read the intent.** `grep -rn ":where(" *.css` and
  ask of each hit whether a comment or doc nearby describes it as enforcing
  something. That phrasing next to a `:where()` is the tell.
- Related: [A global `zoom` scale is usually MEDIA-GATED, so phone CSS is in
  real pixels](media-gated-zoom-scale-phone-real-px.md). These two compounded on
  one 40px button -- the zoom was assumed to pad it and the `:where()` net was
  assumed to floor it, and neither did. When two independent mitigations both
  explain why something undersized is fine, measure the rendered box.
