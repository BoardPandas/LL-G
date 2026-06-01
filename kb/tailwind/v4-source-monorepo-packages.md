---
tech: tailwind
tags: [tailwind-v4, monorepo, source, content-scanning, nextjs, shared-package]
severity: high
---
# Tailwind v4 silently drops utilities used only in shared monorepo packages (needs @source)

## PROBLEM
Under Tailwind v4 (`@tailwindcss/postcss` + `@import "tailwindcss"`), content is auto-detected from the consuming app's own project root only. Sibling/workspace packages (e.g. a shared `packages/ui` consumed via Next.js `transpilePackages`) are NOT scanned. Any utility class that appears ONLY inside that shared package is never generated and is silently dropped from the compiled CSS. tsc and the production build both stay green -- nothing errors; the class simply does nothing.

Real failure: a `<div className="hidden lg:flex">` wrapper in a shared `AppShell` computed to `display:none` even at 2033px wide, because `lg:flex` (used only in `packages/ui`) was never compiled, so only the base `hidden` survived. The persistent sidebar never rendered and the app permanently fell back to the mobile hamburger drawer. Classes that ALSO appear in the app's own `src` (e.g. `bg-surface`, `lg:flex-row`) compiled fine, which masks the problem -- most styling works, only package-only classes vanish.

## WRONG
```css
/* dashboard/src/app/globals.css (Tailwind v4) */
@import "tailwindcss";
/* packages/ui is never scanned -> lg:flex / lg:hidden used only there are
   silently absent from the build, so `hidden lg:flex` stays display:none. */
```

## RIGHT
```css
/* dashboard/src/app/globals.css */
@import "tailwindcss";
/* Scan the shared package so its utilities compile. Path is relative to THIS css file. */
@source "../../../packages/ui/src";
```
Add an `@source` line in EVERY app that renders shared-package components (e.g. dashboard AND admin). Verify the class is now emitted:
```bash
grep -F 'lg\:flex' .next/static/chunks/*.css
```

## NOTES
Distinct from the existing entry "Tailwind 4.x @import resolves from the package directory in monorepos" (v4-workspace-resolution.md): that one is about `@import "tailwindcss"` resolution / adding tailwindcss as a devDependency in the package; THIS one is about CONTENT (`@source`) scanning of the package's template files. You can hit both at once in a v4 monorepo. Symptom signature: a known-good combo like `hidden lg:flex` resolves to `display:none` at large widths while the same utilities work elsewhere in the app.
