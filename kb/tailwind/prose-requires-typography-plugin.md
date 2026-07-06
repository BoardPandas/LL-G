---
tech: tailwind
tags: [prose, typography-plugin, tailwind-4, plugin-registration, silent-failure]
severity: high
---
# prose classes are silently inert without the @tailwindcss/typography plugin

## PROBLEM
`prose`, `prose-sm`, `dark:prose-invert`, etc. come from the `@tailwindcss/typography` plugin. If the plugin isn't installed and registered, the classes compile to nothing: no build warning, no lint error, no runtime message. The page renders with raw browser defaults (headings barely distinguishable from body text, no list/spacing styling), which reads as "the page lost its CSS" and gets misdiagnosed as a layout or import bug. Easy to introduce when copying markup from docs/examples that assume the plugin.

## WRONG
```tsx
// @tailwindcss/typography is NOT in package.json / globals.css
export default function HelpPage() {
  return (
    <main className="mx-auto max-w-2xl prose prose-sm dark:prose-invert">
      <h1>Help</h1>
      <p>Renders as unstyled browser-default text. No error anywhere.</p>
    </main>
  );
}
```

## RIGHT
```css
/* Option A — actually register the plugin (Tailwind 4: in CSS, not config) */
@plugin "@tailwindcss/typography";
```
```tsx
/* Option B — for one or two pages, skip the plugin and use explicit utilities */
<main className="mx-auto max-w-2xl space-y-5">
  <h1 className="text-xl font-bold">Help</h1>
  <p className="text-sm text-muted-foreground">Styled without the plugin.</p>
</main>
```

## NOTES
- Audit for other `prose` consumers before deciding: `grep -rn "prose" src/` — if only one or two pages use it, explicit utilities beat adding a plugin dependency (Vigilis QA-131: the account-recovery help page shipped unstyled to production this way; a report detail page had the same latent bug).
- In Tailwind 4 the plugin registers via `@plugin` in the CSS entry file; a v3-style `plugins: []` array in `tailwind.config.js` is dead unless referenced with `@config` (see v4-config-ignored.md).
