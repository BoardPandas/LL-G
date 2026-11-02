---
tech: nextjs
tags: [app-router, redirect, router.replace, tabs, url-observer, react]
severity: high
---
# A client-side redirect page is seen at its old URL by every URL observer, unlike server redirect()

## PROBLEM
A redirect page written as `useEffect(() => router.replace(dest))` renders and commits the OLD URL first, so any URL observer (a tab strip, recents, analytics) records the stop, while a server `redirect()` never commits the old URL.

It looks harmless because the user lands in the right place. The damage shows up when an observer remembers the stop. Example: an app tab strip gives every `/settings/*` path one shared "Settings" tab that remembers its last URL. A legacy page `/settings/users/:id` client-redirects to `/people/:id`. The Settings tab now remembers the forwarding address. Closing the person's tab moves focus to the neighbouring Settings tab, which forwards straight back, and the observer reopens the person tab: a reopen loop the user cannot close.

## WRONG
```ts
// Route table: a prefix rule claims the redirect stub too
export function identify(path: string) {
  if (path.startsWith('/settings/')) return { id: 'root:/settings', route: path }
  // ...
}
// Live links still point at the stub
<Link href={`/settings/users/${id}`}>View profile</Link>
```

## RIGHT
```ts
const LEGACY_USER_REDIRECT = /^\/settings\/users(?:\/[^/]+)?$/
export function identify(path: string) {
  // Redirect stubs open no tab, checked BEFORE any prefix-claiming rule
  if (LEGACY_USER_REDIRECT.test(path)) return null
  if (path.startsWith('/settings/')) return { id: 'root:/settings', route: path }
  // ...
}
// Link straight to the final destination
<Link href={`/people/${id}`}>View profile</Link>
// On load, drop saved tabs whose stored route now identifies to null
```

## NOTES
- Prefer server `redirect()` (or `next.config` redirects) for legacy addresses; they never commit the old URL. Use a client redirect only when it needs client state, and then exclude it from every URL observer.
- Unknown paths usually get no tab by default; the trap is a rule that claims a whole prefix.
- Also repair persisted state: a stored tab already pointing at the stub keeps looping until pruned.
- Related: nextjs/search-params-stale-after-replace.
