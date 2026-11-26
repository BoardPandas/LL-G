---
tech: react
tags: [tanstack-query, optimistic-update, polling, refetchInterval, cancelQueries, race]
severity: high
---
# A poll that starts during a mutation overwrites the optimistic update

## PROBLEM
The standard TanStack Query optimistic pattern calls `cancelQueries` in `onMutate`, then
writes the new state into the cache. That cancels only the fetches running at that
moment. With `refetchInterval` set, a poll can start a moment later, while the mutation
request is still in flight. The server has not applied the write yet, so the poll
returns the old state and writes it over the optimistic cache entry.

On screen the item jumps back to where it was, then forward again when the mutation
settles and the query is invalidated. With drag and drop or a checkbox it reads as the
write failing. It depends on timing, so it appears now and then in production and almost
never in tests, where the fake API answers at once.

## WRONG
```ts
useQuery({ queryKey: ['tasks', listId], queryFn: fetchTasks, refetchInterval: 10_000 });

useMutation({
  mutationFn: moveTask,
  onMutate: async (move) => {
    await queryClient.cancelQueries({ queryKey: ['tasks', listId] }); // only in-flight fetches
    queryClient.setQueryData(['tasks', listId], (old) => applyMove(old, move));
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', listId] }),
});
```

## RIGHT
```ts
// Pause the poll while any write to this data is pending.
const writesPending = useIsMutating({ mutationKey: ['tasks'] }) > 0;

useQuery({
  queryKey: ['tasks', listId],
  queryFn: fetchTasks,
  refetchInterval: writesPending ? false : 10_000,
});

useMutation({ mutationKey: ['tasks', 'move'], mutationFn: moveTask /* same onMutate */ });
```

## NOTES
- Give every mutation that touches the polled data a shared `mutationKey` prefix, or the
  pause misses some of them.
- Invalidate in `onSettled` only when no other write is pending
  (`queryClient.isMutating({ mutationKey }) === 1`), otherwise the refetch for the first
  write overwrites the optimistic state of the second.
- Window-focus and reconnect refetches have the same race. The pause above does not
  cover them; guard those with the same pending check if they matter.
- To reproduce in a test, delay the fake API's mutation response and resolve a refetch
  with the old state before it.
