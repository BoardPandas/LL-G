---
tech: nextjs
tags: [posthog, analytics, server-side, api-routes]
severity: high
---
# PostHog server SDK must flush immediately in Next.js

## PROBLEM
The `posthog-node` SDK batches events by default (`flushAt: 20`, `flushInterval: 10000`). In Next.js API routes and server components, functions are short-lived — they complete before the batch is flushed, and events are silently lost.

## WRONG
```ts
import { PostHog } from "posthog-node";

// Default batching — events are lost when the function exits
const posthog = new PostHog("phc_xxx", {
  host: "https://us.i.posthog.com",
});
```

## RIGHT
```ts
import { PostHog } from "posthog-node";

const posthog = new PostHog("phc_xxx", {
  host: "https://us.i.posthog.com",
  flushAt: 1,        // flush after every event
  flushInterval: 0,  // no delay
});
```

## NOTES
- This applies to all serverless/short-lived contexts: API routes, server components, middleware, server actions
- The client-side `posthog-js` SDK does NOT need this — it runs in a long-lived browser context
- Use a singleton pattern for the server client to avoid creating multiple instances
