---
tech: nextjs
tags: [metadata, SEO, generateMetadata, client-components]
severity: high
---
# metadata export in Client Components

## PROBLEM
Next.js's `metadata` object export and `generateMetadata()` function only work in Server Components (`page.tsx`, `layout.tsx`). If either is exported from a file marked `'use client'`, Next.js silently ignores the export -- no error, no warning, no metadata in the page `<head>`. This is one of the most common sources of "my SEO metadata isn't working" bugs.

## WRONG
```tsx
'use client'  // Client Component -- metadata export is silently ignored
import { useState } from 'react'

export const metadata = {  // IGNORED -- no error thrown
  title: 'My Page',
  description: 'This description will never appear',
}

export default function Page() {
  const [open, setOpen] = useState(false)
  return <div>...</div>
}
```

## RIGHT
```tsx
// page.tsx -- Server Component (no 'use client')
import { Metadata } from 'next'
import { InteractiveSection } from './InteractiveSection'  // Client Component

export const metadata: Metadata = {  // works -- Server Component
  title: 'My Page',
  description: 'This description appears in <head>',
}

export default function Page() {
  return (
    <div>
      <InteractiveSection />  {/* Client Component for interactivity */}
    </div>
  )
}
```

## NOTES
- Split pages that need both metadata and interactivity: keep `page.tsx` as a Server Component for metadata, extract interactive parts into separate Client Component files
- `generateMetadata()` can be async and accepts `params` and `searchParams` for dynamic metadata
- The `viewport` export (for theme color, viewport settings) follows the same Server Component rule
- Use `export const dynamic = 'force-dynamic'` if `generateMetadata` needs to opt out of caching
