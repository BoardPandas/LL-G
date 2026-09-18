---
tech: react
tags: [forms, filters, draft-state, react-keys, url-state, validation, reports]
severity: high
---
# Mixing draft filters with immediate selectors silently discards pending edits

## PROBLEM

A report keeps date/search inputs in local draft state, but its organization or
technician picker immediately updates the applied URL filters. If the editor is
keyed by those applied filters, confirming the picker remounts it and silently
discards the date/search edits. Even without a remount, merging the selection
into applied rather than draft state omits the pending fields from the request.

There is no exception. Every control works in isolation, and the report returns
valid data for the wrong user-intended scope. An export can further obscure the
mismatch if it remains enabled while visible controls contain unapplied values.

## WRONG

```tsx
// Parent remounts the editor whenever a picker changes applied filters.
<Filters key={serialize(applied)} applied={applied} change={navigate} />

function Filters({ applied, change }) {
  const [draft, setDraft] = useState(applied);
  return <>
    <input value={draft.search ?? ""}
      onChange={e => setDraft({ ...draft, search: e.target.value })} />
    <OrganizationPicker selected={applied.organizationIds}
      onConfirm={ids => change({ ...applied, organizationIds: ids })} />
    <button onClick={() => change(draft)}>Apply filters</button>
  </>;
}
```

Type a search, then confirm an organization. The picker commits the old applied
search value, and the new key resets the local draft.

## RIGHT

Choose one consistent interaction model. For an explicit Apply workflow, let
every filter control edit the same screen-owned draft. Picker confirmation
confirms its local selection into that draft, not directly into the URL.

```tsx
// Remount only for an actual committed scope/navigation or access change.
// stableAppliedKey is a canonical serialization, not a fresh object identity.
<ReportScreen key={tenantAccessKey + ":" + stableAppliedKey}
  applied={applied} commit={navigate} />

function ReportScreen({ applied, commit }) {
  const [draft, setDraft] = useState(applied);
  const [error, setError] = useState("");
  const patch = values => setDraft(current => ({ ...current, ...values }));
  const parsed = filterSchema.safeParse(draft);
  // normalizeFilters sorts/deduplicates IDs, trims search and excludes cursors.
  const dirty = !parsed.success ||
    serialize(normalizeFilters(parsed.data)) !==
    serialize(normalizeFilters(applied));

  function apply() {
    if (!parsed.success) {
      setError("Check dates, timezone and filter combinations.");
      return; // Preserve incomplete input.
    }
    commit({ ...parsed.data, cursor: undefined, groupCursor: undefined });
  }

  return <>
    <input value={draft.search ?? ""}
      onChange={e => patch({ search: e.target.value })} />
    <OrganizationPicker selected={draft.organizationIds}
      onConfirm={organizationIds => patch({ organizationIds })} />
    {error && <p role="alert">{error}</p>}
    {dirty && <p role="status">Results still use the previous filters.</p>}
    <button onClick={apply}>Apply filters</button>
    <button onClick={() => setDraft(applied)}>Discard changes</button>
    <button disabled={dirty} onClick={() => download(applied)}>Export</button>
  </>;
}
```

This is schematic: use the application's actual schema, canonical serializer,
picker and navigation APIs. A scope-tagged state hook can reset the draft
without remounting the whole screen when other screen state must survive.

## NOTES

- Presets, Clear filters, chip removal and attribution selectors must follow the
  same draft rule. Picker Cancel discards only that picker session.
- Do not pass incomplete drafts to a lookup hook that calls a throwing schema
  parser during render. Safe-parse first, show an actionable error and disable
  invalid option requests. Do not silently query an old applied scope while
  displaying a new draft.
- Block or explicitly resolve pending edits before paging, sorting, drilling
  down, refreshing or copying a report link. Scope-changing edits should also
  cancel an in-flight export and prevent a late previous-scope download.
- Reset drafts on genuine external navigation and tenant/access changes. Preserve
  an existing router acknowledgement guard so an older asynchronous URL update
  cannot rewind a newer committed selection.
- Regression-test the combined workflow: edit date and search, confirm each
  attribution picker, verify no report navigation yet, then Apply and assert one
  request contains every edit and neither paging cursor. Also test invalid
  timezone/date combinations, picker Cancel/reopen, Discard, stale requests and
  tenant changes.
- Found and reproduced with a failing-first integration test in SupportForge's
  time-report UI. This is a React state-ownership gotcha, not an agent
  configuration defect; no configuration eval or guard is appropriate.
