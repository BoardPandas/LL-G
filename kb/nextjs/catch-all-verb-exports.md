---
tech: nextjs
tags: [app-router, route-handler, catch-all, http-methods, bff, proxy]
severity: medium
---
# App-router catch-all route only handles the HTTP verbs it explicitly exports

## PROBLEM
An App Router route handler (`app/.../route.ts`) serves only the methods it
exports. A catch-all proxy like `app/api/v1/tickets/[ticketId]/[...path]/route.ts`
that exports just `GET` and `POST` will 404 (Next returns 405/404) on `PUT`,
`PATCH`, or `DELETE` to any sub-path -- even though the path "matches". When you
add a new sub-endpoint and reach for REST semantics (`DELETE /.../links/:x`,
`PUT /.../values`), it silently isn't routed and you debug the backend in vain.

## WRONG
```typescript
// app/api/v1/tickets/[ticketId]/[...path]/route.ts  (only GET + POST exported)
export async function GET(req, { params }) { return proxy(req, params) }
export async function POST(req, { params }) { return proxy(req, params) }
// Frontend later does: fetch(`/api/v1/tickets/${id}/links`, { method: 'DELETE' })
//   -> 405/404, never reaches the backend
```

## RIGHT
```typescript
// Option A: model the new sub-endpoint as POST so it rides the existing catch-all
fetch(`/api/v1/tickets/${id}/unlink`, { method: 'POST', body: JSON.stringify({ ... }) })

// Option B: add the missing verb export to the catch-all route file
export async function DELETE(req, { params }) { return proxy(req, params) }
export async function PATCH(req, { params })  { return proxy(req, params) }
```

## NOTES
Decide per project: a thin BFF that proxies everything benefits from exporting all
verbs once; otherwise keep sub-endpoints to the verbs the catch-all already
forwards. Static route segments take precedence over `[...path]`, so a dedicated
`app/api/.../merge-bulk/route.ts` is also an option for non-id-scoped actions.
