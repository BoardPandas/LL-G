---
tech: tailwind
tags: [arbitrary-values, jit, dynamic-classes, purge]
severity: high
---
# Arbitrary value syntax

## PROBLEM
Tailwind's JIT compiler statically analyzes source files for complete class name strings. Dynamically constructing class names with string concatenation or template literals means Tailwind never sees the full class name -- it is not included in the output CSS and the style silently has no effect.

## WRONG
```tsx
// Dynamic concatenation -- Tailwind never sees 'w-[42px]' as a complete string
const size = '42px'
<div className={`w-[${size}]`} />   // NOT included in CSS output

// Partial class name construction
const prefix = 'text'
const color = 'red-500'
<div className={`${prefix}-${color}`} />  // NOT included in CSS output
```

## RIGHT
```tsx
// Complete class names only -- Tailwind can statically detect these
<div className="w-[42px]" />          // included in CSS output
<div className="text-red-500" />      // included in CSS output

// For dynamic values, use a lookup map of complete class names:
const sizeMap = { sm: 'w-[24px]', md: 'w-[42px]', lg: 'w-[64px]' }
<div className={sizeMap[size]} />     // each value is a complete class name
```

## NOTES
- No spaces inside brackets: `w-[42 px]` is invalid, `w-[42px]` is correct
- Arbitrary values support CSS units: `w-[42px]`, `w-[2.5rem]`, `w-[calc(100%-2rem)]`
- For CSS variables: `bg-[var(--brand-color)]`
- The `safelist` option in `tailwind.config` can force-include classes that are truly dynamic, but prefer the lookup map pattern
