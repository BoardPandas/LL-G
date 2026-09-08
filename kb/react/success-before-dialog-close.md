---
tech: react
tags: [dialogs, authentication, step-up, promises, callbacks]
severity: high
---
# Resolve dialog success before emitting its close callback

## PROBLEM
A shared authentication dialog closes on successful elevation, but the guarded request never retries. The parent treats onOpenChange(false) as cancellation and settles all waiting promises false. The child's subsequent onSuccess callback runs after those waiters have already been consumed. Both callbacks fire and authentication succeeded, making isolated dialog tests misleading.

## WRONG
```tsx
function finish() {
  onOpenChange(false); // Parent settles pending requests as cancelled.
  onSuccess();        // No pending requests remain.
}
```

## RIGHT
```tsx
function finish() {
  onSuccess();        // Settle the successful outcome first.
  onOpenChange(false);
}
```

## NOTES
Test the callback order or the original guarded request's retry, not just whether onSuccess fired. A fetch-based step-up gate must also exclude its own authentication endpoints and observe AbortSignal while waiting, otherwise a factor request can wait on its own dialog or cancelled work can retry later. Preserve a Request clone before its first body is consumed.
