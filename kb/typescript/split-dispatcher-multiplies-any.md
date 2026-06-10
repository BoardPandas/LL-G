---
tech: typescript
tags: [refactoring, any, dispatcher, bullmq, type-safety, file-splitting]
severity: medium
---
# Splitting a switch over an untyped payload multiplies explicit `any`

## PROBLEM
A dispatcher function with one untyped payload (`job.data` from BullMQ, a webhook body, a parsed message) flowing through a `switch` contains exactly one implicit `any`. Splitting that file into exported per-handler functions, the standard move when paying down an oversized file, forces every new handler signature to declare an explicit parameter type. Without prepared payload types, that becomes `data: any` at every handler, each needing a lint suppression. A file with 1 `any` becomes 8 handlers with 8 `any`s and 8 `biome-ignore`/`eslint-disable` comments, degrading a codebase-wide cleanliness metric as a side effect of an otherwise mechanical refactor.

## WRONG
```ts
// Mechanical split, no typing plan:
// biome-ignore lint/suspicious/noExplicitAny: data comes from BullMQ job payload
export async function handleInvoiceReceived(data: any) { ... }
// biome-ignore lint/suspicious/noExplicitAny: data comes from BullMQ job payload
export async function handleContractExpiration(data: any) { ... }
// ... times every handler
```

## RIGHT
```ts
// Either type the payloads as part of (or immediately after) the split:
interface InvoiceReceivedJob { orgId: string; invoiceId: string; correlationId: string }
export async function handleInvoiceReceived(data: InvoiceReceivedJob) { ... }

// Or, if the split must stay strictly behavior-neutral, accept data: any
// in the split commit and file the payload-typing follow-up at the same time,
// so the multiplied any is a tracked debt rather than a silent regression.
```

## NOTES
The handler signatures are the natural place the payload types should have lived all along; the split exposes the missing types rather than creating the problem. Budget the typing pass whenever splitting dispatcher-shaped files (queue processors, webhook routers, notification fan-outs).
