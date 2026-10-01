---
tech: typescript
tags: [forms, units, durations, round-trip, precision, monitoring, react]
severity: high
---
# Rounding display units in an edit draft silently changes saved values

## PROBLEM
An API stores a duration as integer seconds, while an editor displays minutes. If the draft rounds seconds to whole minutes, opening a valid 91-second rule and saving an unrelated change sends 120 seconds. Nothing fails: the new duration passes validation and changes behavior. A generated summary can hide the defect by applying the same rounding.

This also applies to currencies, percentages, storage sizes, and other values whose display unit is coarser than the persisted unit. A readable label is not necessarily a reversible edit representation.

## WRONG
```typescript
const draft = { windowMinutes: Math.round(rule.windowSeconds / 60) };
const saved = { windowSeconds: draft.windowMinutes * 60 };
// 91 seconds becomes 120 even if the duration was never edited.
```

## RIGHT
Keep the canonical unit in edit state where possible. Convert only for rendering and validate the user's edit before updating it.

```typescript
const draft = { windowSeconds: rule.windowSeconds };
const displayedMinutes = draft.windowSeconds / 60;

function secondsFromMinutes(minutes: number): number {
  const seconds = minutes * 60;
  const nearest = Math.round(seconds);
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > 86400
      || Math.abs(seconds - nearest) > 1e-6) {
    throw new Error('Use a duration from 60 to 86400 whole seconds.');
  }
  return nearest; // Normalize floating-point noise only after validating precision.
}
```

When an existing editor must keep minutes internally, initialize with `seconds / 60` without rounding, preserve the fraction, and apply the same precision validation on save. Offer a seconds unit when the stored value is not a whole minute. Do not silently clamp invalid values to a minimum.

## NOTES
- Render exact values in summaries: 91 seconds should not be described as 2 minutes.
- Add a load/edit/save round-trip regression using non-unit-aligned values such as 91 and 901 seconds. Whole-minute fixtures cannot expose this failure.
- Include untouched advanced fields and typed values in round-trip tests. A cosmetic edit must not change the rule's meaning.
- Match each field's server bounds rather than sharing an arbitrary UI maximum across different duration kinds.
