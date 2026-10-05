---
tech: supportforge
tags: [jest, createApp, billing, middleware, testing, 503]
severity: medium
---
# A createApp() test user with an msp_id gets a billing 503

## PROBLEM
Booting the real app with `createApp()` in Jest works without a database, but `checkBillingStatus` looks up the MSP whenever `req.user.msp_id` is set. With no DB it fails closed with `503 {"error":"Billing service temporarily unavailable"}`, which looks like your auth or route is broken.

## WRONG
```ts
// fake authenticated user in an app-level test
rows: [{ id: 5, user_id: 'u1', role: 'technician', msp_id: 'msp_a' /* ... */ }]
// -> 503 from billing before your route runs
```

## RIGHT
```ts
// No MSP: billing skips the lookup and the request reaches the route.
rows: [{ id: 5, user_id: 'u1', role: 'technician', msp_id: null /* ... */ }]
```

## NOTES
Or stub the billing query in the `db.query` spy. Print the response body, not just the status, when an app-level test fails.
