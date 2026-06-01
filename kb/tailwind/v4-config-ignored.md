---
tech: tailwind
tags: [tailwind-v4, config, postcss, theme, migration]
severity: medium
---
# Tailwind v4 ignores tailwind.config.js unless referenced with @config

## PROBLEM
After migrating to Tailwind v4 (`@tailwindcss/postcss` + `@import "tailwindcss"`), a leftover v3-style `tailwind.config.js` (with a `content` array and `theme.extend`) is COMPLETELY IGNORED unless it is explicitly referenced from CSS via `@config`. Editing that config (adding paths to `content`, tweaking `theme.extend.colors`, etc.) has zero effect, which is confusing because the file looks authoritative and the app is clearly themed. In v4, theme tokens and content sources live in CSS (`@theme`, `@source`), not the JS config.

## WRONG
```js
// tailwind.config.js -- silently dead under v4 (no @config anywhere)
module.exports = {
  content: ['./src/**/*.{ts,tsx}', '../packages/ui/src/**/*.{ts,tsx}'], // does nothing
  theme: { extend: { colors: { coral: 'oklch(var(--coral))' } } },     // does nothing
}
```

## RIGHT
```css
/* globals.css -- v4 reads theme + sources from here */
@import "tailwindcss";
@source "../../../packages/ui/src";   /* content scanning */
@theme {                              /* design tokens */
  --color-coral: oklch(var(--coral));
  --color-surface-nav: oklch(var(--surface-nav));
}
/* OR, to keep the JS config, opt in explicitly: */
/* @config "../../tailwind.config.js"; */
```

## NOTES
Detect v4 quickly: `@tailwindcss/postcss` in postcss.config + `@import "tailwindcss"` (not `@tailwind base/components/utilities`) in globals. If both are true, treat `tailwind.config.js` as dead unless an `@config` directive exists. Don't waste time editing the JS config to fix missing classes -- fix `@source`/`@theme` in CSS instead (see the v4 `@source` content-scanning entry).
