---
tech: css
tags: [custom-properties, css-variables, var, design-tokens, iacvt, silent-failure, linting, ci]
severity: high
---
# A `var(--x)` naming a token that does not exist is silent, and WHICH property it breaks decides the symptom

## PROBLEM

Referencing a custom property that is never defined is not a parse error and not
a console warning. The declaration is **Invalid At Computed-Value Time** (IACVT,
css-variables-1 §3.2): the whole declaration is thrown away at computed-value
time and the property falls back to `unset`.

`unset` is the trap, because it means two different things:

| Property | `unset` means | Symptom |
|---|---|---|
| **inherited** (`color`, `font`, `visibility`) | `inherit` | takes the parent's value — looks *slightly* off, reads as deliberate |
| **non-inherited** (`transition`, `transform`, `background`) | `initial` | `transition: transform var(--nope)` becomes `transition: none` — the animation never runs at all |

So one typo class produces two symptoms that nobody files as the same bug. The
inherited case is a design nitpick nobody reports. The non-inherited case is
read as "we never animated that."

Nothing catches it. Biome and ESLint have no rule for it. Stylelint's
`custom-property-no-missing-var-function` is the *reverse* check (a token used
without `var()`). The shipped static tree is typically excluded from tsconfig
and covered by no test, so typecheck and lint are both green.

Measured: 45 dead references survived months in a production dashboard —
`--text-1` in 38 places across 3 files (the scale was `--text`, `--text-2`..`-4`;
there had never been a `--text-1`), `--transition-base` in 6, `--text-5` in 1.
`biome check` passed clean on every one of those files both before and after the
fix.

The nastiest variant *looks* defended:

```css
color: var(--accent-text, var(--text-1));
```

`--accent-text` is undefined, so it falls to the fallback — which is itself a
bare reference to an undefined token. A fallback chain terminating in another
dead end is still IACVT.

## WRONG

```css
/* ds/tokens.css defines --text, --text-2, --text-3, --text-4.
   There is no --text-1 and no --text-5. There is no --transition-base;
   the tokens are --transition-fast / -snap / -slide. */

.combo-card-name {
  color: var(--text-1);              /* inherited -> parent's color. Just looks dim. */
}
.checkdot-off {
  color: var(--text-5);              /* the "off" dot inherits the row color,
                                        so an ABSENT flag renders as PRESENT. */
}
.tile-cover {
  transition: transform var(--transition-base);   /* -> transition: none.
                                        The hover lift does not animate AT ALL. */
}
.pill.on {
  color: var(--accent-text, var(--text-1));  /* fallback to a second dead end */
}
```

And the detection that does **not** work — a bare grep for `var(` cannot tell a
bug from a deliberate optional knob, and reports green while reading nothing:

```bash
grep -rn 'var(--' src/   # thousands of hits, most of them correct. Useless.
```

## RIGHT

Point at a token that exists, or make the reference *explicitly* optional:

```css
.combo-card-name { color: var(--text); }
.checkdot-off    { color: var(--text-4); }
.tile-cover      { transition: transform var(--transition-fast); }
.pill.on         { color: var(--accent-text, var(--text)); }

/* Legitimate and must NOT be flagged: an optional knob set from JS or an
   inline style attribute, with a real default baked in. */
.art { height: var(--art-h, 200px); }
```

Gate it in CI by diffing references against definitions. The one rule that makes
this precise: **only a BARE `var(--x)` is a bug.**

```js
// A definition. Run it over .css AND .html/.js too, so tokens written into a
// template literal or an inline style attribute count. Over-matching here only
// makes the gate more permissive; under-matching FAILS A GOOD BUILD.
const DEF = /(?:^|[;{\s"'`])(--[A-Za-z0-9_-]+)\s*:/g;
const DEF_SET_PROPERTY = /setProperty\(\s*[`'"](--[A-Za-z0-9_-]+)/g;  // no colon

// A BARE reference: nothing between the name and the ')'. `var(--x, fallback)`
// does not match, which is exactly right -- that form is intentional.
// Bonus: this catches the nested case for free. In `var(--a, var(--b))` the
// INNER reference is itself bare, so --b must exist.
const REF_BARE = /var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g;

// error <=> bare reference whose token appears in no definition anywhere
```

## NOTES

- **Chrome DevTools does grey out / strike through an IACVT declaration** in the
  Styles pane — but only for the one element you happened to inspect. That is
  why these survive: you never inspect the element that merely looks a bit dim.
- **A name-existence check is the right scope; do not try to be scope-aware.**
  Treat a token as defined if *any* file declares it, including inside
  `[data-theme="light"]` or a media query. Proving a definition is in scope at
  every use site needs a real cascade model, and the bug that actually ships is
  the name not existing at all.
- **The gate must assert its own coverage** or "no findings" means nothing — see
  `typescript/lint-must-assert-its-own-coverage.md`. Cross-check the parsed
  definition and reference counts against a dumb textual count of the same tree,
  each with a lower-bound floor (~70-80% of today's measured value), so a
  pattern that silently stops matching fails instead of passing on an empty set.
  Prove it red by reintroducing a known-bad token before trusting it.
- **Same failure shape as the missing-token bug, different axis:** a token that
  exists but is defined *after* / at lower specificity than its use is a
  cascade problem, not IACVT, and this check will not see it. See
  `stylesheet-load-order-equal-specificity.md`.
- A repo-wide sweep typically surfaces a dozen undefined-but-fallback'd tokens
  (`--art-h`, `--pip-sz`, `--z-sheet`). Those are correct by construction.
  Flagging them is how a well-meaning gate gets switched off.
