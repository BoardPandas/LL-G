---
tech: react
tags: [accessibility, radix-ui, progress, wrappers, aria, testing]
severity: high
---
# Forward progress values to the accessible primitive

## PROBLEM

A React progress wrapper can destructure `value` to position its visual indicator and accidentally omit that prop from the accessible root. The bar looks correct, TypeScript accepts the wrapper, and visual checks pass, but the root exposes no `aria-valuenow`. Assistive technology receives an indeterminate progress bar even when the application knows the exact value.

The mistake occurred in SupportForge's shared Radix Progress wrapper. Every consumer inherited the missing accessible value.

## WRONG

```tsx
function Progress({ value, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root {...props}>
      <ProgressPrimitive.Indicator
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
```

The rest object no longer includes the destructured `value`.

## RIGHT

```tsx
function Progress({ value, ...props }: ProgressProps) {
  return (
    <ProgressPrimitive.Root {...props} value={value}>
      <ProgressPrimitive.Indicator
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
```

Forward the original value to the primitive so it owns its accessible state. Keep an omitted value omitted; defaulting the root to zero converts genuinely indeterminate loading into a false zero-percent measurement. The example uses the default 0-100 range; custom maxima also require matching visual normalization.

## NOTES

- Test the real wrapper with 0, a partial value such as 50, and 100. Assert the named `progressbar` exposes the corresponding `aria-valuenow` and `aria-valuemax`.
- Separately omit `value` and assert `aria-valuenow` is absent. Zero is a valid determinate value, not an absent value.
- Give each consumer a meaningful accessible name. A correct number without context is still difficult to interpret.
- Test semantic output as well as appearance. Do not mock away the accessible primitive in the regression test.
- Existing enforcement: SupportForge's `dashboard/src/components/__tests__/Progress.test.tsx` covers all four cases. This is a component behavior defect, so no agent-configuration guard is appropriate.
