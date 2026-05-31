---
tech: nextjs
tags: [base-ui, dropdown-menu, menu, error-boundary, app-router, shadcn, group-label, production-error-31]
severity: high
---
# base-ui Menu.GroupLabel crashes the whole page when used outside a Menu.Group

## PROBLEM
base-ui's `Menu.GroupLabel` (what shadcn's `DropdownMenuLabel` maps to) calls `useMenuGroupRootContext()` and THROWS when it is not nested inside a `Menu.Group` / `Menu.RadioGroup`. The thrown message is "Base UI: MenuGroupContext is missing. Menu group parts must be used within <Menu.Group> or <Menu.RadioGroup>."

Three things make this hard to debug:

1. It is page-fatal, not a local glitch. The label only renders when the menu OPENS, so the crash fires on click, not on initial load.
2. In the Next.js App Router, where the throw lands depends on which segment owns the component. If the menu lives in a LAYOUT subtree (e.g. a top-bar notification bell mounted by the app shell), the throw bubbles PAST the page-level `error.tsx` up to the ROOT `app/error.tsx`. The page blanks to a generic "This page couldn't load" while the URL stays unchanged (e.g. still `/dashboard`), so it looks like the dashboard broke, not the menu.
3. In production the message is minified to "Base UI error #31" (decode at https://base-ui.com/production-error?code=31). The real cause is invisible unless you map the code.

Confirmed in the wild: a notification bell crashed on every open because its `DropdownMenuLabel` was a direct child of `DropdownMenuContent` with no group wrapper. Five other menus (column toggles, bulk toolbars, snooze submenus, a CRM view-actions menu) had the same latent crash.

## WRONG
```tsx
<DropdownMenuContent>
  {/* DropdownMenuLabel === base-ui Menu.GroupLabel, which needs a group context */}
  <DropdownMenuLabel>Notifications</DropdownMenuLabel>
  <DropdownMenuSeparator />
  <DropdownMenuItem onClick={...}>Mark all read</DropdownMenuItem>
</DropdownMenuContent>
// On open: throws "Base UI error #31"; bubbles to the nearest error boundary
// (the ROOT one if the menu is in a layout), blanking the page.
```

## RIGHT
```tsx
// Option A — wrap the label in a group (per-call fix):
<DropdownMenuContent>
  <DropdownMenuGroup>
    <DropdownMenuLabel>Notifications</DropdownMenuLabel>
  </DropdownMenuGroup>
  <DropdownMenuSeparator />
  <DropdownMenuItem onClick={...}>Mark all read</DropdownMenuItem>
</DropdownMenuContent>

// Option B — harden the shared primitive once so a standalone label can
// never crash a menu again. Render a plain styled element instead of
// Menu.GroupLabel:
function DropdownMenuLabel({ className, inset, ...props }: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn("px-1.5 py-1 text-xs font-medium text-muted-foreground data-inset:pl-7", className)}
      {...props}
    />
  );
}
```

## NOTES
- Same trap applies to other group-only parts: `Menu.RadioItem` requires a `Menu.RadioGroup` ancestor (a different context, also throws if missing). `CheckboxItem` does NOT require a group.
- Decode any "Base UI error #N" via https://base-ui.com/production-error?code=N, or find the dev message at the throwing call site in node_modules (search `_formatErrorMessage(N)`).
- General App Router lesson: a render throw in a layout subtree is caught by the PARENT segment's error boundary, not the same-segment `error.tsx`. Put boundaries accordingly, and never assume the URL reflects which component threw.
- Option B (plain div) loses the group's `aria-labelledby` linkage; acceptable for standalone section-header labels, which is the overwhelmingly common usage.
