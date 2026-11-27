---
tech: react
tags: [tanstack-query, scroll, skeleton, placeholderData, live-updates]
severity: medium
---
# A refetch under a new query key shows the skeleton and throws away the scroll position

## PROBLEM
A thread is refreshed by putting a `refreshKey` in the query key and bumping it on every live event. Each bump is a new query with no data, so the component renders its loading skeleton, the scroll container shrinks, and the browser clamps `scrollTop`. When the data arrives the reader is somewhere else. In a list that reads towards the bottom (newest last, pinned above a composer) this happens on every incoming message.

## WRONG
```tsx
useQuery({ queryKey: ['thread', id, page, refreshKey], queryFn })
if (isLoading) return <Skeleton />
```

## RIGHT
```tsx
useQuery({
  queryKey: ['thread', id, page, refreshKey],
  queryFn,
  // keep the previous page while refetching, but never another record's rows
  placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === id ? prev : undefined),
})
if (isLoading) return <Skeleton /> // isLoading is now only the very first load
```

## NOTES
TanStack Query v5: `placeholderData` as a function receives the previous data and query; v4 used `keepPreviousData: true`. Pinning to the bottom on open also needs a short settle window driven by a ResizeObserver, because Markdown and images grow the content after the first scroll.
