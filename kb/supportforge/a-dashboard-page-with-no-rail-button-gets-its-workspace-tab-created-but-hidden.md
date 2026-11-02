---
tech: supportforge
tags: [workspace-tabs, rail, navigation, dashboard, nextjs]
severity: high
---
# A dashboard page with no rail button gets its workspace tab created but hidden

## PROBLEM
The workspace tab strip shows only tabs whose `sectionId` is in the user's rail, so a new top-level page without a rail button opens a tab that never appears.
The tab exists in state and the route table identifies it correctly, so tab-route unit tests pass; only the provider's `visibleTabs(tabs, reachable)` filter hides it. `railSectionFor` also falls back to `tickets`, and the layout's section switch falls back to Settings nav, so the page can show the wrong sidebar or be orphan-redirected.

## WRONG
```ts
// rail.ts: new page gets a section id, nothing else
['/search', 'search'],
// WorkspaceTabsContext: reachable = rail ids only -> 'search' tab hidden
new Set(rail.map((item) => item.id))
```

## RIGHT
```ts
export const RAILLESS_SECTIONS: readonly string[] = ['search']
new Set([...rail.map((item) => item.id), ...RAILLESS_SECTIONS])
// plus: layout `case 'search'` (no section nav), ORPHAN_EXEMPT_PREFIXES,
// and a ROOT_EXTRA entry in tab-routes so the URL maps to a tab.
```

## NOTES
Test the provider with a real `rail` prop: a harness that omits `rail` skips the filter and hides the bug.
