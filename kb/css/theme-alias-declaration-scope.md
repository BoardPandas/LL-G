---
tech: css
tags: [custom-properties, themes, design-tokens, inheritance, dark-mode]
severity: high
---
# Theme aliases resolve where declared, not where consumed

## PROBLEM

A dark theme overrides canonical CSS tokens on a nested application wrapper,
but components using compatibility aliases keep light-theme colors. The CSS
parses and builds successfully. Inspecting the canonical tokens shows correct
dark values, so the failure can look like a component specificity problem.

Custom-property references are substituted at computed-value time on the
element that declares them. Descendants inherit that computed value. An alias
declared only on `:root` does not re-evaluate when a descendant changes the token
it references.

## WRONG

```css
:root {
  --text: #172033;
  --fg: var(--text);
}
.theme-dark { --text: #edf2f8; }
.legacy-component { color: var(--fg); }
```

Inside `.theme-dark`, `--text` is light but the inherited `--fg` remains dark.

## RIGHT

```css
:root, .theme-light { --text: #172033; }
.theme-dark { --text: #edf2f8; }
:root, .theme-light, .theme-dark { --fg: var(--text); }
.legacy-component { color: var(--fg); }
```

Declare dependent aliases at every theme boundary, or migrate consumers to the
canonical tokens directly. Apply the same rule to derived gradients, shadows,
and other semantic aliases when their dependencies vary by theme.

## NOTES

Found while unifying six Svelte/Wails desktop entrypoints. Root-only legacy
aliases made remote and utility windows mix light foregrounds/backgrounds with
dark canonical tokens. Re-declaring aliases on the nested theme classes fixed
the computed colors without component-specific overrides.

Verify a component under both light and dark wrappers using `getComputedStyle`
on the actual consuming property, not just by inspecting token declarations.
Include nested theme boundaries and separately mounted dialogs in visual QA.
