---
tech: postgres
tags: [query-builder, filters, boolean-logic, saved-views, validation]
severity: high
---
# Preserve independent alternatives when translating saved filters

## PROBLEM

A flat filter object often means AND between fields and OR within each field. Translating all selected alternatives into one match-any group changes `(status A OR status B) AND (category X OR category Y)` into `status A OR status B OR category X OR category Y`. The database returns valid, plausible rows, but the saved view silently includes records outside the intended intersection.

An editor can cause the same scope expansion when it removes incomplete or unknown conditions before saving or previewing. A cleared input should not become permission to omit a predicate.

## WRONG

```sql
WHERE status IN ('open', 'pending')
   OR category IN ('hardware', 'software')
```

```typescript
const definition = { all: [], any: [...statusConditions, ...categoryConditions] };
save({ ...definition, all: definition.all.filter(isComplete) });
```

## RIGHT

```sql
WHERE status = ANY($1::text[])
  AND category = ANY($2::text[])
  AND (priority = $3 OR assignee_email = $4)
```

```typescript
const definition = {
  all: [
    { field: 'status', operator: 'is', value: ['open', 'pending'] },
    { field: 'category', operator: 'is', value: ['hardware', 'software'] },
  ],
  any: existingAlternatives,
};
if (!everyConditionIsComplete(definition)) {
  showError('Complete or remove unfinished conditions.');
  return;
}
save(definition);
```

## NOTES

- Validate membership arrays explicitly: allowed field/operator, nonempty bounded list, string elements and permitted enum values. Bind arrays using the actual database column type. Reject unsupported combinations instead of coercing an array into comma-separated scalar text.
- Preserve raw status aliases that the source filter actually matches. Unknown values must not disappear during translation; report an invalid view or refuse a lossy conversion.
- Use the same validated definition for list execution, counts, preview and save. Test the legacy translation path as well as newly created condition objects.
- Test the cross-product: a record matching only status, one matching only category, one matching both and one matching neither. Only the intersection should qualify. Include an existing independent OR group, empty arrays, unknown statuses, cleared inputs and parameter alignment.
- A query-builder UI must preserve every selected value when loading and editing. A missing option source should show the stored value, not visually substitute the first available choice.
- This is query and form behavior, not agent configuration. Enforce it with predicate/route/editor regression tests; no configuration guard is needed.
