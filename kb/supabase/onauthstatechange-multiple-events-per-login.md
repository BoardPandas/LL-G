---
tech: supabase
tags: [supabase-js, auth-js, gotrue, onAuthStateChange, INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, detectSessionInUrl, implicit-flow, lock, navigator-locks, re-entrancy]
severity: high
---
# onAuthStateChange fires several times for ONE login -- never do once-per-login work in the callback

## PROBLEM
`supabase.auth.onAuthStateChange(cb)` is widely written as if it were a login hook. It is not: a single sign-in delivers **multiple** qualifying events, and the callback is re-entered concurrently. Any once-per-login side effect placed there — showing a modal, seeding a row, firing analytics, kicking off a migration — runs more than once.

The OAuth path is deterministic, not a race. In `auth-js`, `_initialize()`'s implicit-grant branch is:

```js
await this._saveSession(session)
setTimeout(async () => {
  await this._notifyAllSubscribers('SIGNED_IN', session)   // DETACHED
}, 0)
return { error: null }                                      // returns immediately
```

The notify sits in a detached `setTimeout`, so `_initialize()` resolves without it. `_emitInitialSession()` then delivers **`INITIAL_SESSION`** on the microtask queue, and the timer delivers **`SIGNED_IN`** on the macrotask queue right after. Two events, ~0 ms apart, **every login**.

Beyond that: `SIGNED_IN` is re-emitted on tab refocus via the `visibilitychange` → `_recoverAndRefresh()` path, and cross-tab through `BroadcastChannel` (which bypasses the lock entirely). Supabase's own docs warn to *"avoid making assumptions as to when this event is fired, this may occur even when the user is already signed in."*

Two amplifiers make it worse:

1. **A no-op `lock`.** `lock: async (_n, _t, fn) => await fn()` is a popular fix for Navigator LockManager timeouts. It removes the cross-context serialization that was the only thing keeping `_initialize`, `_recoverAndRefresh` and `_callRefreshToken` from notifying subscribers concurrently.
2. **Awaiting anything slow in the callback.** `_notifyAllSubscribers` does `await Promise.all(subscribers.map(x => x.callback(event, session)))`. Awaiting a network call — or worse, a user's click on a modal — holds the emitter, and with a real lock holds the auth lock, which is what produces the 10 s LockManager timeouts that tempt people into fix #1. It is a loop: blocking the callback causes the timeout, the no-op lock "fixes" the timeout, and the missing serialization then lets the callback run concurrently.

## WRONG
```js
supabase.auth.onAuthStateChange(async (event, session) => {
  if (session && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
    const cloud = await loadFromCloud();          // await #1 -- yields
    if (cloud && hasLocalData()) {
      const choice = await showMergePrompt();     // await #2 -- unbounded human latency
      ...                                          // re-entered long before this
    }
  }
});
```

## RIGHT
```js
let syncingUserId = null;
let syncedUserId = null;

supabase.auth.onAuthStateChange(async (event, session) => {
  if (!session || (event !== 'SIGNED_IN' && event !== 'INITIAL_SESSION')) return;

  const userId = session.user.id;
  // Idempotency key, not a boolean: distinguishes "already done" from "different user".
  if (syncingUserId === userId || syncedUserId === userId) return;
  syncingUserId = userId;

  let failed = false;
  try {
    ...
  } catch (e) {
    failed = true;                 // let a later event retry a transient failure
  } finally {
    syncingUserId = null;
    if (!failed) syncedUserId = userId;
  }
});
```

## NOTES
- Guard on the **user id**, not a boolean — a boolean breaks account switching, and clearing it on `SIGNED_OUT` alone is not enough (see below).
- Only record "done" on success. Marking it in a bare `finally` makes one transient network failure permanent for the page's lifetime, where the unguarded version would have retried on the next event.
- Also clear the guards in your own `logout()`. If `signOut()` is raced against a timeout (a common workaround for it hanging on an expired token), `SIGNED_OUT` may never be emitted, and a stale guard then skips the cloud load on the next login.
- Sync-lifecycle helpers called from the callback must be idempotent. A `startSync()` invoked from a `finally` on every event stacks duplicate subscriptions that nothing ever releases; have it call its own `stopSync()` first.
- `TOKEN_REFRESHED` is a *separate* event — code branching only on `SIGNED_IN`/`INITIAL_SESSION` falls through it silently, which changes which of the paths above you land on depending on token age.
- Do not block the callback on user interaction. Capture what you need, return, and drive the UI outside the subscriber.
- CDN consumers pinning the floating `@supabase/supabase-js@2` tag get emission-behaviour changes with no code change on their side. Pin a minor if this matters.
- Symptom to watch for: a modal opened from this callback appearing **twice**, stacked. If it is wired with `document.getElementById`, the visible copy has no listeners at all — see [duplicate-id-getelementbyid-remounted-modal](../dom/duplicate-id-getelementbyid-remounted-modal.md).
