---
tech: better-auth
tags: [client, react, hooks, createAuthClient, useSession, import]
severity: high
---
# Use better-auth/react for React hooks, not better-auth/client

## PROBLEM
`better-auth/client` creates framework-agnostic signal-based atoms. The returned `useSession` is an atom, not a callable React hook -- calling it as `useSession()` either does nothing or throws. The React hooks are only available from `better-auth/react`.

## WRONG
```typescript
import { createAuthClient } from "better-auth/client"
const { useSession } = createAuthClient({ baseURL: "..." })

// useSession is an Atom, not a hook
const session = useSession()  // wrong return type, not reactive in React
```

## RIGHT
```typescript
import { createAuthClient } from "better-auth/react"
const { useSession } = createAuthClient({ baseURL: "..." })

// useSession is a proper React hook
const { data: session, isPending } = useSession()
```

## NOTES
- `better-auth/react` wraps the atoms as proper React hooks using the React signal adapter.
- `better-auth/vue`, `better-auth/svelte` etc. follow the same pattern -- always use the framework-specific export.
- The `signIn`, `signOut`, and other action methods work the same in both exports; only reactive/hook APIs differ.
