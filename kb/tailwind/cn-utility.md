---
tech: tailwind
tags: [cn, clsx, twMerge, conditional-classes, class-conflicts]
severity: high
---
# Conditional classes with cn()

## PROBLEM
When Tailwind classes conflict (e.g., `p-4` and `p-2`), the last one in the stylesheet wins -- not the last one in the string. This is determined by Tailwind's generated CSS order, not the order in your `className` string. Using template literals or string concatenation for conditional classes silently produces wrong results when conflicting utilities are combined.

## WRONG
```tsx
// Template literal -- both classes included, stylesheet order determines winner
// If 'p-4' comes after 'p-2' in the CSS, p-2 is always ignored regardless of condition
<div className={`p-2 ${isLarge ? 'p-4' : ''}`} />

// Object spread -- same problem
const base = 'p-2 text-sm'
const extra = isLarge ? 'p-4 text-lg' : ''
<div className={`${base} ${extra}`} />  // conflicting classes, unpredictable result
```

## RIGHT
```tsx
// cn() from 'clsx' + 'tailwind-merge' -- last conflicting class wins correctly
import { cn } from '@/lib/utils'  // standard location for cn() helper

<div className={cn('p-2 text-sm', isLarge && 'p-4 text-lg')} />
// cn() deduplicates and resolves conflicts: result is 'p-4 text-lg' when isLarge
```

```ts
// Standard cn() implementation (lib/utils.ts):
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

## NOTES
- Install both packages: `npm install clsx tailwind-merge`
- `clsx` handles conditional logic (falsy values, arrays, objects)
- `twMerge` resolves Tailwind-specific class conflicts by removing the earlier conflicting class
- The `cn()` helper is the standard pattern in shadcn/ui and most modern Next.js starters
- Without `twMerge`, even `clsx` alone will not resolve Tailwind conflicts
