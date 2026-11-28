---
tech: react
tags: [tanstack-query, react-query, removequeries, sign-out, cache, data-leak, remount, key, shared-device]
severity: high
---
# TanStack Query: removeQueries does not redraw a page that is already showing the data, so sign-out can leave the previous person's rows on screen

## PROBLEM
On sign-out the app calls `queryClient.removeQueries()` (or `clear()`) to drop cached data. That removes the cache entries, but it does **not** re-render components that are already mounted and showing that data. If the next person signs in on the same device without a full page load, the protected pages can still show the previous person's rows until a refetch replaces them. A request that was in flight for the old session can also resolve afterwards and put the old person's data back.

## WRONG
```tsx
async function signOut() {
  await api.signOut();
  queryClient.removeQueries();      // cache emptied; mounted observers keep their last result
  navigate("/sign-in");
}
```

## RIGHT
```tsx
// 1. Remount the protected subtree whenever the signed-in identity changes.
<ProtectedArea key={session?.userId ?? "signed-out"}>
  <Outlet />
</ProtectedArea>

// 2. Drop responses that belong to an earlier session.
async function signOut() {
  await queryClient.cancelQueries();   // late responses from the old session are discarded
  await api.signOut();
  queryClient.clear();
}
```

## NOTES
- Keying by identity gives every component under it a fresh mount, so nothing from the previous session can remain on screen.
- If queries cannot be cancelled, tag each response with the session it was requested under and ignore mismatches.
- Test: sign in as A, open a list, sign out, sign in as B without reloading, and assert none of A's rows are in the DOM before B's data arrives.
