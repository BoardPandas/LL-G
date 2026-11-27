---
tech: supportforge
tags: [dashboard, navigation, orphan-routes, redirect, nextjs, tests]
severity: medium
---
# Removing a dashboard nav row makes its page redirect away until the page is registered as row-less

## PROBLEM

The dashboard's orphan guard (`dashboard/src/lib/nav/orphan-routes.ts`) reacts to
the *navigation*, not to the route files. A route counts as present only when a nav
row points at it or at an ancestor of it. Anything else is treated as a page that
was merged away, and the viewer is sent to the section's first row.

So when a redesign takes a row out of the nav but keeps the page (it is now opened
from a button, a footer link or another page), the page still builds, still
type-checks and still renders in a unit test. In the running app it redirects to
the section's first row the moment it loads, and the page looks deleted.

Three other things read the nav tree and break in the same change:

1. The document title and the workspace tab label come from the nav row, so a
   row-less page falls back to the section's name.
2. Search and the destinations list are built from the nav trees, so the page
   stops being findable.
3. Tests that looked the row up in the nav array (`NAV.find(...)`) now fail, or
   worse, pass vacuously if they only asserted the row was absent for a role.

## WRONG

```ts
// nav file: the row is simply deleted, the page folder is kept.
export const RMM_NAV: NavSection[] = [
  { section: '', items: [home, devices, organizations] },
  // 'Add a device' row removed; /rmm/connect-code still exists on disk
]
```

```ts
// test still looks for the row in the tree
const row = RMM_NAV.flatMap((s) => s.items).find((i) => i.href === '/rmm/platform-health')
expect(row?.label).toBe('Platform health') // undefined after the move to the footer
```

## RIGHT

Keep the page as a named entry outside the tree, and feed that entry to everything
that used to read the row:

```ts
// nav file
export const ADD_DEVICE_PAGE: NavItem = { label: 'Add a device', href: '/rmm/connect-code' }
export const RMM_ROWLESS_PAGES: readonly NavItem[] = [ADD_DEVICE_PAGE]

// the sections the orphan guard and the title lookup read include the row-less pages
export function rmmRouteSections(capabilities) {
  return [...RMM_NAV, { section: '', items: [...RMM_ROWLESS_PAGES] }]
}
```

```ts
// destinations / search
const ALL = [...RMM_NAV.flatMap((s) => s.items), ...RMM_ROWLESS_PAGES, PLATFORM_HEALTH_ROW]
```

```ts
// tests name the exported entry, not a position in the tree
expect(PLATFORM_HEALTH_ROW.href).toBe('/rmm/platform-health')
```

If the page really is gone, delete its folder in the same change and add a redirect
for the old URL. A page reached only from a list or a tab (a detail route) belongs
in `ORPHAN_EXEMPT_PREFIXES` instead.

## NOTES

- Check each removed row against four readers before committing: the orphan guard,
  the document title, the destinations/search list and the tests.
- A row shown only to holders of a capability needs the same gate where it is
  re-added for search, or the search result leaks a page the viewer cannot open.
- The guard runs in the browser after the nav is known, so no build step, type
  check or component test reports this. Open the page in the running app.
- Related: [Moving a dashboard page out of Settings silently removes it from search](moving-a-dashboard-page-out-of-settings-removes-it-from-search.md).
