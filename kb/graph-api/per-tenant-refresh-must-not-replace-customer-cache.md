---
tech: graph-api
tags: [microsoft-365, multi-tenant, cache, postgres, transactions, sync]
severity: high
---
# Per-tenant refreshes must not replace a customer-wide cache

## PROBLEM

A customer can map to several Microsoft tenants. A sync that fetches one tenant, deletes rows by customer, and inserts that tenant's rows silently erases the previous tenant's data. Every request can succeed while the final report contains only the last tenant. Parallel execution makes the surviving tenant unpredictable. Moving the delete outside the loop is still unsafe if partial reads or inserts replace a complete report.

## WRONG

```typescript
for (const tenant of customer.tenants) {
  const rows = await fetchAllReportPages(tenant);
  await db.query('DELETE FROM report_cache WHERE customer_id = $1', [customer.id]);
  await insertRows(db, customer.id, rows);
}
```

## RIGHT

```typescript
// Illustrative pseudocode. Scope includes the owning account and customer.
for (const report of reportCatalog) {
  try {
    const rows = [];
    for (const tenant of customer.tenants) {
      rows.push(...await report.fetchAllPages(tenant));
    }
    await db.transaction(async tx => {
      await lockCacheReplacement(tx, account.id, customer.id, report.name);
      await report.deleteCustomerRows(tx, account.id, customer.id);
      await report.insertRows(tx, account.id, customer.id, rows);
    });
  } catch (error) {
    logRefreshFailure(report.name, error);
    // A read failure never starts replacement; a write failure rolls it back.
    // The previous complete report remains available.
  }
}
```

## NOTES

- Fetch every expected tenant and every page before replacing that report. Validate that all tenant contexts belong to the same account/customer. Never treat a failed or malformed read as a valid empty result.
- A successful empty report from every tenant should clear stale rows. An empty tenant-context list is not proof that the customer has no data; handle removal through an explicit mapping/purge path.
- Replace each independent report atomically. One unavailable report need not prevent other complete reports from refreshing. A documented fallback can count as a completed read only when its meaning is suitable for that report.
- Fetch outside the transaction; serialize replacement inside it. A lock prevents interleaved delete/insert operations but does not by itself prevent an older snapshot committing later; use freshness/version ordering if that matters.
- Preserve tenant identity when upstream IDs are only tenant-unique. Reduce summary totals across tenants instead of letting the last summary overwrite the earlier ones.
- Regression cases: two tenants both survive; a second-tenant read failure retains the old complete report; a second insert failure rolls back; valid empty reports clear old rows; unrelated reports still refresh; mixed customer scopes are rejected.
- This was found in SupportForge's Microsoft customer report sync. It is a cache-scope defect, not an upstream Graph data-loss behavior.
