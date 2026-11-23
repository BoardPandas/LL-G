---
tech: mcp
tags: [mcp, hub, multi-execute, truncation, structuredcontent, oneleet, pagination, monitors]
severity: high
---
# Hub MULTI_EXECUTE_TOOL truncates results over 100 KB and drops structuredContent

## PROBLEM
The MCP Hub's `MULTI_EXECUTE_TOOL` cuts any single tool result at about 100 KB. The text content ends in
`[Result truncated: kept 100000 of N bytes]`, and the `structuredContent` copy of the same data is dropped
entirely. Nothing marks the call as failed (`ok: true`), so a list read looks complete while its later rows are
simply gone.

List endpoints that embed large nested objects hit this fast. Oneleet's `TenantVendorList` returns each
vendor's full assessment template inline, so about 10 vendors exceed 100 KB. A count of "vendors found" from
the truncated text is wrong with no error. Batching several tools into one call does not help: each result is
cut on its own.

The underlying server may also refuse outright: Oneleet's `VendorList` (the shared catalog) returns
"larger than the 1048576 bytes a tool result can carry" with `isError: true`.

## WRONG
```js
// One list call, then trust whatever rows came back
const r = (await hub.multiExecute([{ tool_slug: "oneleet__TenantVendorList", arguments: {} }])).results[0];
const rows = r.result.structuredContent?.rows ?? parseText(r.result.content); // structuredContent missing; text truncated
console.log(`${rows.length} vendors`); // undercount, no error
```

## RIGHT
```js
const r = (await hub.multiExecute([{ tool_slug: "oneleet__TenantVendorList", arguments: {} }])).results[0];
const text = r.result.content.map(c => c.text).join("");
if (!r.result.structuredContent || /Result truncated/.test(text)) {
  // Treat the list as incomplete. Take only ids from it (newest-first rows survive),
  // then read each item with a narrow per-item tool.
}
// Per item: TenantVendorGetAssessment / TenantVendorGet, a few per call.
```

## NOTES
- Always check for `structuredContent` and the truncation marker before counting anything from a Hub result.
- Results newest-first means a newly added row is still at the top of a truncated list, so the id of a vendor
  you just created can be read from it; the totals cannot.
- Recovering ids from the kept prefix: the cut text is not valid JSON, so `JSON.parse` fails. Split it into rows
  at each row start (`{"createdAt":` for `TenantVendorList`) and take the row-level `"id"` that comes just
  before `"isCompleted"`. The first UUID in a row is often a linked evidence id, because the `evidence` array
  comes first, not the tenant vendor id. Confirm each id with a per-item read (`TenantVendorGetAssessment`)
  before passing it to a write such as `EvidenceUpdateLinkToVendor`.
- Finding an older item that fell past the cut: newest-first means older rows are the ones lost, and a
  read-only agent reading only the kept prefix will wrongly report the vendor as "not tracked". Search a
  monitor whose asset type covers the items instead. For Oneleet vendors, the "All vendors are assessed"
  monitor (asset type `oneleetVendor_v1`) works: `MonitorAssetResultList` with its monitor id and
  `search: "<vendor name>"` returns one small row whose `assetInstanceId` ends in
  `oneleetVendors-<tenantVendorId>` and whose `linkUrl` contains `/vendors/<tenantVendorId>/`. Get the monitor
  id once from `MonitorList` (itself truncated, so search the kept text for the monitor name), then confirm
  the vendor id with `TenantVendorGet`. Its row counts also give the true vendor total.
- The durable fix is to keep each item id in your own records when you create or first read the item, so later
  work never needs the full list.
- Related: [hub-execute-command-times-out-after-about-60-100s.md](hub-execute-command-times-out-after-about-60-100s.md).
