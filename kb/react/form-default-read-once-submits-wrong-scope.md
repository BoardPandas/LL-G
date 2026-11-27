---
tech: react
tags: [forms, useState, default-value, async, race, scope, approval]
severity: high
---
# A form that reads its default once submits the wrong scope when the default is still loading

## PROBLEM
`useState(initial)` and uncontrolled `defaultValue` read their initial value on the first render only. If the form mounts while the query that supplies its scoped default is still in flight, it keeps the fallback for good, and the fallback is usually the widest one.

Observed: an "Approve update" form defaulted its organization picker to "All organizations". Opened from a row menu on one device's page, it mounted before the device's organization had loaded, so a reason and one click approved the update for every organization in the tenant. No error, and the form looked normal.

A redesign exposed it rather than caused it. The form used to be reachable only from inside a drawer that had already loaded the data, so the default was always there by the time the form mounted. Moving the action to a row menu removed that accidental ordering.

## WRONG
```tsx
function DecisionForm({ defaultOrgIds }: { defaultOrgIds: string[] }) {
  const [orgIds, setOrgIds] = useState(defaultOrgIds) // [] while loading, and [] means "all"
  // ...
}

<DecisionForm defaultOrgIds={scoped.data?.orgIds ?? []} />
```

## RIGHT
```tsx
// Do not mount the form until the scoped default has settled.
if (scope.deviceId && scoped.isPending) return <Spinner label="Finding this device's organization" />
if (scope.deviceId && !scoped.data?.orgIds.length) return <ChooseOrganization required />

<DecisionForm key={scoped.data.orgIds.join()} defaultOrgIds={scoped.data.orgIds} />
```

## NOTES
- Make the empty value mean "nothing chosen", not "everything". A default of "all" that is reachable by accident is the real hazard.
- When the scoped lookup fails or finds nothing, require an explicit choice. Do not fall back to the wide default.
- Keying the form on the default re-seeds it, but also throws away what the user typed if the default changes late. Holding the mount is safer for a form that commits something.
- Test by rendering the form with the query pending, then resolving it: assert the submit is unavailable before, and the scoped value is selected after.
- Any time an action moves to a new entry point (a row menu, a deep link, a keyboard shortcut), re-check what the old entry point guaranteed was loaded.
