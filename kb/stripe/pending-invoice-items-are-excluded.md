---
tech: stripe
tags: [invoices, invoice-items, idempotency, credits, webhooks]
severity: high
---
# Pending invoice items are excluded from new invoices

## PROBLEM

Creating an invoice item without an invoice ID leaves it pending. Modern Stripe invoice creation defaults `pending_invoice_items_behavior` to `exclude`, so an immediately created invoice can have a zero balance and become paid. A paid webhook may grant the purchased entitlement even though the charge remains pending for a later subscription invoice. Unit tests that mock every Stripe operation as successful miss the incorrect relationship between the item and invoice.

## WRONG

```ts
await stripe.invoiceItems.create({ customer, amount, currency: 'usd' });
const invoice = await stripe.invoices.create({ customer });
await stripe.invoices.finalizeInvoice(invoice.id);
```

## RIGHT

```ts
const key = `${tenantId}-${requestId}`;
const invoice = await stripe.invoices.create({
  customer, auto_advance: false, collection_method: 'charge_automatically',
  pending_invoice_items_behavior: 'exclude', metadata,
}, { idempotencyKey: `invoice-${key}` });
await stripe.invoiceItems.create({
  customer, invoice: invoice.id, amount, currency: 'usd',
}, { idempotencyKey: `item-${key}` });
await stripe.invoices.finalizeInvoice(invoice.id, {}, { idempotencyKey: `finalize-${key}` });
await stripe.invoices.pay(invoice.id, {}, { idempotencyKey: `pay-${key}` });
```

## NOTES

Generate the request ID once per purchase attempt and reuse it after transport failures. Assert operation order, exact amount, item invoice ID, and each idempotency key. Treat a requires-action PaymentIntent as unfinished until the client completes authentication. Isolate entitlement invoice webhooks from subscription state changes even when metadata is invalid. Deduplicate grants using the paid invoice ID.

References: [Create invoice](https://docs.stripe.com/api/invoices/create), [Create invoice item](https://docs.stripe.com/api/invoiceitems/create).
