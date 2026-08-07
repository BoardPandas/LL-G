---
tech: postgres
tags: [any, array, delete, sync, reconciliation, data-loss, integration, empty-result]
severity: high
---
# An empty API result makes a `NOT (col = ANY($1))` delete sweep wipe the whole table

## PROBLEM
The standard way to reconcile a local mirror against an upstream API is: upsert
everything the API returned, then delete every local row it did *not* return.
Written as `DELETE ... WHERE NOT (external_id = ANY($1))`, that sweep is correct
for every input except one — the empty array.

`ANY('{}')` matches nothing, so `NOT (external_id = ANY('{}'))` is TRUE for every
row and the statement deletes the entire table for that tenant.

The trap is that an empty upstream list is not rare and does not look like an
error. It is produced by a **successful HTTP 200** in at least four ordinary
situations:

- a vendor-side outage or partial degradation returning `{"items": []}`
- a credential that was revoked, expired, or lost a permission scope — many APIs
  answer 200 with an empty collection rather than 401/403
- a response schema change (`items` renamed to `data`), where the parser's
  defensive `if (Array.isArray(res.items))` guard turns the unknown shape into
  an empty list instead of throwing
- a pagination bug that exits the loop before the first page is read

Nothing raises. The sync reports success. If a daily snapshot/metrics job runs
after the sweep in the same pass, it records the post-delete count as a genuine
point-in-time measurement, so the deletion is also written into history where it
cannot be backfilled.

Note the asymmetry that makes this worth a guard rather than a comment: keeping
stale rows is self-correcting — the next successful sync reconciles them.
Deleting live rows is not, because the local mirror was the only copy.

## WRONG
```ts
const items = await fetchAllFromApi(creds); // 200 + [] on outage/permission/schema change

for (const item of items) {
  await db.query(UPSERT_SQL, [tenantId, String(item.id), item.name]);
}

// items = [] -> ANY('{}') matches nothing -> NOT(...) is true for EVERY row
await db.query(
  `DELETE FROM mirrored_items WHERE tenant_id = $1 AND NOT (external_id = ANY($2))`,
  [tenantId, items.map((i) => String(i.id))]
);

// Runs against the now-empty table and freezes the loss into history.
await db.query(SNAPSHOT_SQL, [tenantId]);
```

## RIGHT
```ts
const items = await fetchAllFromApi(creds);

for (const item of items) {
  await db.query(UPSERT_SQL, [tenantId, String(item.id), item.name]);
}

// "The account genuinely has zero items" is indistinguishable from "the fetch
// returned nothing", so take the recoverable branch and let the next run fix it.
if (items.length > 0) {
  await db.query(
    `DELETE FROM mirrored_items WHERE tenant_id = $1 AND NOT (external_id = ANY($2))`,
    [tenantId, items.map((i) => String(i.id))]
  );
} else {
  console.warn(`[sync] upstream returned no items for ${tenantId} — skipping sweep`);
}
```

Assert it in a test with a mocked db — the empty case never shows up in a
happy-path fixture:

```ts
it('does not sweep when the API returns an empty list', async () => {
  global.fetch = mockApi({ items: [] });
  await syncTenant(cred);
  expect(mockQuery.mock.calls.filter(([sql]) => sql.includes('DELETE FROM'))).toHaveLength(0);
});
```

## NOTES
- The length guard only catches a *fully* empty result. A truncated page (5 of
  539 items) still sweeps the remaining 534. If the upstream paginates, consider
  a proportional guard — skip when the returned count falls more than X% below
  the current row count — and log every skip.
- A defensive `if (Array.isArray(res.items))` in the fetch loop converts a
  renamed key into silent emptiness. Keep the guard, but `console.warn` in the
  `else` so a schema change surfaces as a log line instead of a deletion.
- `NOT (x = ANY(arr))` and `x <> ALL(arr)` are equivalent here and share the
  behavior; neither is a workaround for the other. Beware also that `NOT (x =
  ANY(arr))` yields NULL — so the row is *not* deleted — when `x` is NULL or the
  array contains a NULL, which is the opposite failure and can leave ghosts.
- Same shape appears in `WHERE id NOT IN (SELECT ...)` reconciliation and in ORM
  `deleteMany({ id: { notIn: ids } })` calls. Audit those for the empty case too.
- Related: [A column that exists but is NULL corpus-wide makes any filter on it
  silently match zero rows](filter-on-empty-column-matches-nothing.md) — both are
  cases where an empty input produces a confident, silent, wrong result set.
