---
tech: react-native
tags: [tanstack-query, react-query, polling, appstate, focus-manager, background, expo]
severity: high
---
# TanStack Query interval refetch never pauses on native without focusManager

## PROBLEM
On the web, React Query treats a window blur as "unfocused" and pauses interval
refetching (`refetchIntervalInBackground` defaults to false). On React Native
there is no window, so `focusManager` reports the app as permanently focused.
Every screen's `refetchInterval` therefore keeps firing network requests while
the app is backgrounded, silently draining battery and cellular data. Nothing
errors and nothing looks wrong in the foreground, so the leak is easy to ship.
`refetchOnWindowFocus` is also effectively dead for the same reason, so data is
not refreshed on resume the way it is on web.

## WRONG
```ts
// query.ts -- native focus is always "on", so these intervals never pause.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true } },
});
// ...and screens just set refetchInterval, assuming background = paused:
useQuery({ queryKey: ["tickets"], queryFn: listTickets, refetchInterval: 30_000 });
```

## RIGHT
```ts
import { AppState, Platform, type AppStateStatus } from "react-native";
import { focusManager, QueryClient } from "@tanstack/react-query";

// Wire React Query's focus state to the OS app state, once at startup.
focusManager.setEventListener((handleFocus) => {
  const onChange = (status: AppStateStatus) => {
    if (Platform.OS !== "web") handleFocus(status === "active");
  };
  const sub = AppState.addEventListener("change", onChange);
  return () => sub.remove();
});
// Now background marks the app unfocused -> interval refetch pauses
// (refetchIntervalInBackground is off by default), and refetchOnWindowFocus
// refreshes stale queries on resume.
```

## NOTES
Register the listener at module load next to the QueryClient so it is set up
before any query mounts. This is the officially recommended RN setup, but it is
easy to skip because everything appears to work in the foreground. If you
genuinely need a query to keep polling while backgrounded, set
`refetchIntervalInBackground: true` on that specific query.
