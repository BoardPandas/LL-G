---
tech: base-ui
tags: [base-ui, react, imports, package-rename, dialog, vite, mui]
severity: high
---
# Base UI rc.0 imports from `@base-ui-components/react`, not the renamed `@base-ui/react` the docs show

## PROBLEM
As of `@base-ui-components/react@1.0.0-rc.0` the installed package name is `@base-ui-components/react`, but base-ui.com's current component pages already show imports from the post-rename package `@base-ui/react`. The rename happened *after* rc.0. Copying an import straight from the live docs resolves to a module that isn't installed, so the build/typecheck fails (or, worse, an editor auto-import picks the wrong specifier and it only fails at build). The docs also track newer part/prop names than rc.0 ships, so trusting the docs for the API — not just the import — can be subtly wrong.

## WRONG
```tsx
// Copied verbatim from base-ui.com — the package isn't installed under this name in rc.0
import { Dialog } from "@base-ui/react/dialog";
```

## RIGHT
```tsx
// The installed package (v1.0.0-rc.0) is @base-ui-components/react, with per-component subpaths.
import { Dialog } from "@base-ui-components/react/dialog";

// Verify the exact subpath against node_modules/@base-ui-components/react/package.json "exports"
// (./dialog, ./select, ./field, ./alert-dialog, ./popover, ...). Each component is its own subpath.
// Confirm actual parts/props from the installed .d.ts, NOT the docs, since docs track the newer package.

<Dialog.Root open={open} onOpenChange={(o) => setOpen(o)} modal>
  <Dialog.Portal>
    <Dialog.Backdrop />
    <Dialog.Viewport>
      <Dialog.Popup initialFocus={ref}>
        <Dialog.Title>…</Dialog.Title>
        <Dialog.Description>…</Dialog.Description>
        <Dialog.Close render={(props) => <button {...props}>Close</button>} />
      </Dialog.Popup>
    </Dialog.Viewport>
  </Dialog.Portal>
</Dialog.Root>
```

## NOTES
Dialog API facts verified from the installed rc.0 types (not the docs):
- Parts: `Dialog.Root / Trigger / Portal / Backdrop / Viewport / Popup / Title / Description / Close`.
- `Root` props: `open`, `onOpenChange(open, eventDetails)`, `defaultOpen`, `modal` (default `true`), `disablePointerDismissal` (turns off backdrop / outside-click close).
- `Popup` props: `initialFocus` / `finalFocus`.
- Focus trap + restore-to-trigger + `role="dialog"`/`aria-modal` + `aria-labelledby`/`describedby` (from Title/Description) are built in when `modal`.
- Escape and backdrop click close by default.
- Polymorphism uses a `render` prop, NOT Radix's `asChild` — don't port a Radix `asChild` pattern.

Base UI is the MUI-team successor to Radix; in a monorepo remember Tailwind must still be a devDependency of the consuming package (see the Tailwind index). Discovered building a copy-owned Dialog/ConfirmDialog primitive layer in a React 19 + Vite SPA where a dev server wasn't available to iterate, so the import + API had to be right from the types on the first write.
