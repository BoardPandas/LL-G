---
tech: nextjs
tags: [next-font, css-variables, tailwind, theme, fonts]
severity: medium
---
# A next/font CSS variable referenced by fixed name in CSS must match the loader's `variable` exactly

## PROBLEM
next/font exposes a font through a CSS custom property whose name you choose via the loader's `variable` option (e.g. `variable: "--font-mono"`). Stylesheets and Tailwind v4 `@theme` blocks reference that property by a hard-coded name (e.g. `--font-mono: var(--font-mono)`). If the loader's `variable` name and the name referenced in CSS drift apart -- renaming one side, or copying a `var(--font-jetbrains-mono)` reference while the loader declares `variable: "--font-mono"` -- nothing errors. The `var()` lookup just resolves to its fallback (or to nothing), and the font silently falls back to a system default. No build error, no console warning; the page simply renders in the wrong typeface.

## WRONG
```ts
// layout.tsx
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });
```
```css
/* globals.css -- references a name the loader never defined */
@theme inline {
  --font-mono: var(--font-mono);
}
```

## RIGHT
```ts
// layout.tsx -- variable name matches what globals.css expects
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
```
```css
/* globals.css */
@theme inline {
  --font-mono: var(--font-mono);
}
```

## NOTES
Treat the CSS variable name as a contract between the font loader and the stylesheet. Grep for the `var(--font-*)` names in CSS and confirm each has a matching `variable:` in a next/font loader call. Failure mode is silent fallback, never a thrown error, which is why it is easy to miss in review.
