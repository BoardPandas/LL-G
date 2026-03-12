---
tech: nextjs
tags: [use-client, server-components, client-components, directives]
severity: high
---
# 'use client' directive placement

## PROBLEM
`'use client'` must be the very first line of a file (before any imports). If placed after an import, or in a file that imports server-only modules (e.g., `server-only`, `next/headers`, database clients), the build fails or the module silently executes on the wrong side of the boundary.

## WRONG
```tsx
import { something } from './lib'  // import BEFORE directive
'use client'                        // too late -- ignored or error

export default function Component() { ... }
```

```tsx
'use client'
import { cookies } from 'next/headers'  // server-only API in a Client Component
// Error: cookies() is not available in Client Components
```

## RIGHT
```tsx
'use client'  // must be line 1, before all imports

import { useState } from 'react'
import { something } from './lib'  // lib must NOT import server-only modules

export default function Component() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}
```

## NOTES
- The `'use client'` boundary is a module graph boundary, not a component boundary. All modules imported by a Client Component are also treated as client-side.
- To mix server data with client interactivity: fetch data in a Server Component, pass it as props to a Client Component child
- `'use server'` is for Server Actions (async functions called from client), not for marking a module as server-only
- Use the `server-only` package to explicitly prevent a module from being imported in Client Components
