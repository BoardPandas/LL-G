---
tech: blocknote
tags: [blocknote, shadcn, tailwind, tailwind4, css, base-ui, tiptap, styling]
severity: medium
---
# @blocknote/shadcn styling traps under Tailwind 4

## PROBLEM
`@blocknote/shadcn` renders its menus and toolbars with raw Tailwind utility classes shipped in `node_modules`. Tailwind 4 never scans `node_modules` by default, so the editor UI renders unstyled. Further traps:

- It expects a `--radius` CSS variable (shadcn convention); without it rounded corners collapse.
- Its open/close animations rely on `tw-animate-css`; without it menus pop with no animation.
- It is built on **Base UI**, not Radix -- shadcn components or Radix-based patterns in your app do not compose with its popovers.
- Its stylesheet contains unscoped `.ProseMirror table`, `.ProseMirror td` and `.ProseMirror th` rules, which restyle any other Tiptap/ProseMirror editor on the same page (e.g. a ticket composer).

## WRONG
```css
/* globals.css */
@import "tailwindcss";
@import "@blocknote/shadcn/style.css";
/* bn utility classes never generated; tables in the other Tiptap editor restyled */
```

## RIGHT
```css
/* globals.css */
@import "tailwindcss";
@import "tw-animate-css";
@source "../node_modules/@blocknote/shadcn/dist";   /* path relative to this CSS file; ~30 KB more CSS */

:root { --radius: 0.5rem; }
```
```css
/* Re-scope BlockNote's table rules under .bn-container (copy them into your own
   stylesheet instead of importing them unscoped, or override for the other editor) */
.bn-container .ProseMirror table { /* ... */ }
.bn-container .ProseMirror td,
.bn-container .ProseMirror th   { /* ... */ }
```

## NOTES
- Verify the `@source` path resolves from the CSS file's directory; in a pnpm monorepo the app-level `node_modules/@blocknote/shadcn` symlink is the stable target.
- Check any page that mounts both BlockNote and another ProseMirror editor for table styling leakage.
- Observed on BlockNote 0.56.0, Tailwind 4, Next.js 16, 2026-10-19.
