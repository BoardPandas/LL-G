---
tech: supportforge
tags: [pax8, invoices, aggregation, customer-scope, multi-tenant, billing]
severity: high
---
# Partition distributor invoices by invoice and customer

## PROBLEM

A distributor invoice can contain line items for several customers. Grouping only by its invoice ID produces a plausible total but silently labels that combined amount with the first customer's name. Fixing the list alone is insufficient: a detail drawer that requests only the distributor invoice ID can recombine the customers and disagree with the selected row.

SupportForge's licensing-invoice review exposed this with Pax8 data. The list needed separate customer partitions, and each detail request needed the selected row's customer scope even when the overall page filter was All customers.

## WRONG

```typescript
const grouped = new Map<string, Invoice>();
for (const row of authorizedRows) {
  const invoice = grouped.get(row.invoiceId) ?? {
    invoiceId: row.invoiceId,
    clientId: row.clientId, // First customer's identity survives.
    amount: 0,
  };
  invoice.amount += row.amount;
  grouped.set(row.invoiceId, invoice);
}
openDetail(`/invoices/${selected.invoiceId}`);
```

## RIGHT

```typescript
const grouped = new Map<string, Invoice>();
for (const row of authorizedRows) {
  const key = JSON.stringify([row.invoiceId, row.clientId]);
  const invoice = grouped.get(key) ?? {
    invoiceId: row.invoiceId,
    clientId: row.clientId,
    amount: 0,
  };
  invoice.amount += row.amount;
  grouped.set(key, invoice);
}
const query = new URLSearchParams({ client_id: selected.clientId });
openDetail(`/invoices/${selected.invoiceId}?${query}`);
```

On the server, derive the MSP from the authenticated context, verify the selected customer belongs to it, and constrain both invoice and item reads by that MSP and customer. A client-side query parameter is a scope request, not authorization. Use the same partition key for row identity, selection and caching where those layers can otherwise collide.

## NOTES

- Regression fixtures must include two customers sharing one invoice ID and multiple items for one customer. Assert separate list totals and matching scoped detail totals.
- Test All customers plus one-customer filters, retained selection, and cross-MSP/customer rejection. Keep existing authorization checks intact.
- Preserve source identity and currency boundaries when merging multiple distributors. Do not sum unlike currencies into a customer subtotal.
- The correction changes presentation and read scope; it does not rewrite accounting records or issue payments.
- Existing enforcement: SupportForge's `client-invoice-scope.test.ts` and invoice-route/list tests cover scope and partition totals. This is behavioral data handling, so no agent-configuration guard is appropriate.
