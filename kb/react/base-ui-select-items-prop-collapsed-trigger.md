---
tech: react
tags: [base-ui, shadcn, select, items-prop, collapsed-trigger, label-resolution]
severity: medium
---
# base-ui Select shows the raw value in its collapsed trigger without an items prop

## PROBLEM
A base-ui (shadcn v4) `<Select>` built with children-only `<SelectItem>` labels renders the raw stored value in the collapsed trigger instead of the friendly label. Labels resolve from mounted items, so the trigger falls back to the raw value before hydration/mount and permanently for any value that has no matching `<SelectItem>` (e.g. an assignee whose membership was later removed, or a filtered-out option). Users see internal enums and ids like `partner_member`, a bare `4`, or a raw cuid where a name should be. Nothing errors or warns.

## WRONG
```tsx
<Select value={role} onValueChange={setRole}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="partner_admin">Admin</SelectItem>
    <SelectItem value="partner_member">Member</SelectItem>
  </SelectContent>
</Select>
{/* Collapsed trigger can read "partner_member" instead of "Member". */}
```

## RIGHT
```tsx
const ROLE_ITEMS = [
  { value: "partner_admin", label: "Admin" },
  { value: "partner_member", label: "Member" },
];

<Select value={role} onValueChange={setRole} items={ROLE_ITEMS}>
  <SelectTrigger>
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {ROLE_ITEMS.map((r) => (
      <SelectItem key={r.value} value={r.value}>
        {r.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

## NOTES
- When the stored value can reference a since-removed entity (assignee, deleted option), the value won't be in the normal options list at all: resolve a label for the stale value explicitly and include it in `items` (optionally rendered as a disabled `<SelectItem>` such as "Jane Doe (removed)"), or the trigger shows the raw id even with `items` set.
- Recurred three separate times in Vigilis before being recognized as a bug class (system-logs level filter, support-access duration selects on both planes, invite-role select, CSM picker).
