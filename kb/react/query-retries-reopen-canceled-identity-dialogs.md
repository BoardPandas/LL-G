---
tech: react
tags: [tanstack-query, authentication, cancellation, retries, dialogs]
severity: high
---
# Automatic query retries can reopen canceled identity dialogs

## PROBLEM

A fetch interceptor handles a step-up authentication refusal by opening an identity dialog, retrying once after successful verification, and returning the original refusal after cancellation. Its own cancellation tests pass. But TanStack Query can retry the rejected query or mutation outside that interceptor, opening a fresh dialog immediately after the person canceled the first one. Each layer appears correct in isolation, and tests that construct a QueryClient with retries disabled miss the production behavior.

## WRONG

```ts
new QueryClient({
  defaultOptions: {
    queries: { retry: 1 },
    mutations: { retry: 1 },
  },
})
// The interceptor returns the server's STEP_UP_REQUIRED response on cancel.
// The API client throws it; Query then retries fetch and reopens the dialog.
```

## RIGHT

```ts
function retryTransientFailure(failureCount: number, error: Error) {
  if (error instanceof ApiError &&
      ['STEP_UP_REQUIRED', 'FORBIDDEN', 'UNAUTHORIZED'].includes(error.code)) {
    return false
  }
  return failureCount < 1
}

new QueryClient({
  defaultOptions: {
    queries: { retry: retryTransientFailure },
    mutations: { retry: retryTransientFailure },
  },
})
```

Keep structured error codes through the transport. Show the original refusal with an explicit confirmation or retry action. A retry predicate does not alter server authorization or treat a canceled request as successful.

## NOTES

- This pattern preserves an existing transient retry policy. Mutations should only retry when the operation's idempotency and failure semantics permit it.
- Test reads and writes using the application's actual QueryClient defaults. Assert one request for authorization refusals, successful explicit recovery, and bounded retry for temporary failures. Also keep the dialog/interceptor cancellation tests.
- Polling, reconnect, remount and focus refetches are separate triggers. Review those policies for protected reads; disabling retry alone does not suppress every future request.
- Observed in SupportForge monitoring: canceling channel verification reopened the dialog because the production client retried the refusal once. Fixed in supportforge-platform commit 45d713d9b.
- Related: [Resolve dialog success before emitting its close callback](success-before-dialog-close.md).
