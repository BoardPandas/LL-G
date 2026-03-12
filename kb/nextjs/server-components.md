---
tech: nextjs
tags: [server-components, async, data-fetching, useEffect]
severity: medium
---
# Async Server Components

## PROBLEM
Developers familiar with React 18 (client-side) patterns default to `useEffect` + `useState` for data fetching. In Next.js App Router, Server Components are async natively -- wrapping data fetching in `useEffect` forces the component to be a Client Component, loses server-side rendering benefits, and adds unnecessary loading states.

## WRONG
```tsx
'use client'  // forced client because of useEffect
import { useState, useEffect } from 'react'

export default function UserList() {
  const [users, setUsers] = useState([])

  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(setUsers)
  }, [])

  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

## RIGHT
```tsx
// No 'use client' -- this is a Server Component
import { db } from '@/lib/db'

export default async function UserList() {
  const users = await db.user.findMany()  // direct DB access, runs on server
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

## NOTES
- Server Components can `await` directly at the top level -- no `useEffect`, no `useState`
- They have direct access to databases, file system, environment variables, and server-only APIs
- They cannot use browser APIs, event handlers, or React hooks
- For interactivity: extract the interactive part into a separate Client Component, pass server-fetched data as props
- `loading.tsx` and `Suspense` boundaries handle async loading states automatically in the App Router
