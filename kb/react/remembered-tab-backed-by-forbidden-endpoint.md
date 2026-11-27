---
tech: react
tags: [permissions, tabs, localStorage, 403, ux]
severity: medium
---
# A remembered tab backed by an endpoint the viewer cannot call is a permanent error state

## PROBLEM
A panel that used to render nothing for viewers without access is promoted to a tab. The endpoint behind it returns 403 for most roles. Those viewers now see an error with a Retry button that can never succeed. If the selected tab is persisted (localStorage), one click strands them on the error tab on every later visit. Unit tests pass because they render as an admin.

## WRONG
```tsx
const [tab, setTab] = useStoredTab('details')
<Tabs value={tab}>{/* Details | Customer | Activity for everyone */}</Tabs>
// Activity: fetch('/api/audit') -> 403 -> "Couldn't load activity. Try again"
```

## RIGHT
```tsx
const tabs = isAdmin ? ['details', 'customer', 'activity'] : ['details', 'customer']
const [stored, setTab] = useStoredTab('details')
const tab = tabs.includes(stored) ? stored : 'details'
// and treat 403 as "not available to you", with no Retry
```

## NOTES
Hide the tab rather than loosening the API gate. When a component moves from "renders null without access" to a first-class destination, list which roles can load it and add a test for a role that cannot.
