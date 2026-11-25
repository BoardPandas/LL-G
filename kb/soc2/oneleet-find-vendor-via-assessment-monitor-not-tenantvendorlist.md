---
tech: soc2
tags: [oneleet, vendors, mcp-hub, truncation, monitor, vendor-id]
severity: high
---
# Oneleet: find a vendor through the vendor-assessment monitor, not TenantVendorList

## PROBLEM
`oneleet__TenantVendorList` returns the whole vendor list in one response, newest first, and takes only
`tenant` and `includeDeleted`: no paging, filter, or field selection. Each vendor carries its full catalog
entry and questionnaire, so about 25 vendors make a response of roughly 480-500 KB. Through an MCP hub that
caps a result at 100 KB, only the newest dozen or so vendors are readable. A search of that output for an
older vendor finds nothing, and "not in the vendor list" is a false negative. Leaving out deleted vendors
saves only a few percent. `TenantVendorGet` needs an id you do not have yet, and `VendorList` is the shared
catalog, not your tenant's vendors.

## WRONG
```json
{"tool_slug": "oneleet__TenantVendorList",
 "arguments": {"tenant": "<tenant-id>", "includeDeleted": false}}
// response truncated at 100 KB -> grep "acme" -> 0 hits -> "Acme is not a vendor" (wrong)
```

## RIGHT
```json
{"tool_slug": "oneleet__MonitorAssetResultList",
 "arguments": {"monitor": "<all-vendors-are-assessed-monitor-id>", "search": "acme"}}
// every tracked vendor is an asset row; 0 rows really means not tracked.
// The row's linkUrl ends /vendors/<tenant-vendor-id>/assessment -> use that id with TenantVendorGet.
```

## NOTES
- Find the monitor id once with `oneleet__MonitorList` ("All vendors are assessed"). It is per tenant.
- `statusCounts` gives the total vendor count without reading the list (e.g. passing 25).
- A vendor added a moment ago shows up as ALERTING ("Assessment ... has not been completed") within seconds.
- The hub truncation itself: see `kb/mcp/hub-multi-execute-truncates-results-over-100kb-and-drops-structuredcontent.md`.
