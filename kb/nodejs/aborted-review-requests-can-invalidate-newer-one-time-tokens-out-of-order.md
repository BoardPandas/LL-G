---
tech: nodejs
tags: [fetch, abort-controller, concurrency, review-token, race-condition]
severity: high
---
# Aborted review requests can invalidate newer one-time tokens out of order

## PROBLEM

Aborting `fetch()` stops the browser from consuming the response, but it does not guarantee that
the server stopped handling the request. If a newer review finishes first and issues token B, the
abandoned older request can finish afterward and issue token A. A grant store that supersedes the
previous unreserved token on every issue then invalidates B, even though B is the token shown by
the newest UI state. The primary action appears enabled but receives a review-required conflict.

This race hides in client-only fetch mocks because those usually reject the aborted request before
the simulated server performs any work.

## WRONG

```js
async function review() {
  activeController?.abort();
  activeController = new AbortController();
  const response = await fetch("/review", { signal: activeController.signal });
  currentReview = await response.json();
}

// The server may still reach this after the abort.
grantStore.issue({ actorUserId, resourceId, projection });
```

## RIGHT

```js
let reviewInFlight = null;
let reviewQueued = false;

function reviewLatest() {
  reviewQueued = true;
  reviewInFlight ||= drainReviews().finally(() => {
    reviewInFlight = null;
    if (reviewQueued) reviewLatest();
  });
  return reviewInFlight;
}

async function drainReviews() {
  while (reviewQueued) {
    reviewQueued = false;
    await sendLatestReview(); // requests finish server-side in issue order
  }
}
```

Alternatively, make the server understand a session-scoped monotonic review sequence and refuse to
let an older sequence supersede a newer one. On commit, recover review-required conflicts
automatically, but retry the protected action only when the refreshed reviewed outcome is identical;
otherwise stop and require confirmation of the changed review.

## NOTES

Keep the token short-lived and one-time. Serialize or sequence review issuance rather than making
tokens longer-lived. Add a browser/server-shaped regression test where the first request completes
after the second and confirm the token displayed by the UI remains committable.
