---
tech: northflank
tags: [api, errors, validation, debugging, rest]
severity: high
---
# API errors come back as { error: { message, details } }, not a string

## PROBLEM
Northflank v1 API error responses nest everything under an `error` OBJECT:
`{ "error": { "status": 400, "message": "...", "id": "nf-invalid-request-body", "details": { "<field>": ["..."] } } }`.
Client code that reads `response.data.error` as if it were a string (or passes the
body straight to `new Error(...)`) renders `[object Object]` and throws away
`details` -- which is the only place the actual failing field is named. Every
"Request failed payload validation - see details" becomes undebuggable.

## WRONG
```ts
const data = err.response?.data;
const message = data?.message ?? data?.error ?? "Request failed"; // data.error is an OBJECT
throw new Error(message); // -> "Northflank API Error (400): [object Object]"
```

## RIGHT
```ts
const data = err.response?.data;
const nested = data && typeof data.error === "object" ? data.error : null;
const message =
  nested?.message ??
  data?.message ??
  data?.error_description ??
  (typeof data?.error === "string" ? data.error : undefined) ??
  err.message;
const details = nested?.details; // { "<field>": ["..."] } -- surface this in the thrown error
throw new ApiError(message, details);
```

## NOTES
When a wrapper/SDK hides the body, hit the REST API directly with curl + the bearer
token to read `error.details`. Status code is a strong hint on create: a **404**
usually means an invalid region/cluster id, a **400** is body validation (field in
`details`), a **405** means that method isn't allowed on that path.
