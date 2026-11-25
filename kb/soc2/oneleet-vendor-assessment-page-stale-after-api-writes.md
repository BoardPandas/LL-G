---
tech: soc2
tags: [oneleet, vendors, risk-level, portal, stale-state, api]
severity: high
---
# Oneleet vendor assessment page shows stale state after API writes; reload before Complete assessment

## PROBLEM
After answering a vendor's assessment, adding data inventory items, and linking evidence through the
Oneleet API, the vendor's assessment page in the portal can still show the state from before those
writes: an "Overridden risk level" of Low, no linked evidence, and "Needed for completion: vendor data
storage, business criticality...". Nothing on the page says it is stale. Risk level can only be set in
the portal (the API never sets it), so the next step is to click "Complete assessment" on that page.
Clicking it against the stale state risks saving the wrong risk level, which then looks settled.
A reload showed the real state: assessment complete, both evidence files listed, and a suggested level
of Moderate.

## WRONG
```text
1. TenantVendorUpdateAssessment + TenantVendorDataInventoryCreate + EvidenceUpdateLinkToVendor (API)
2. open /tenants/<tenant-id>/vendors/<tenant-vendor-id>/assessment#risk-level
3. read "Overridden risk level: Low" -> click "Complete assessment"
```

## RIGHT
```text
1. Same API writes.
2. Open the assessment page, then reload it (location.reload()).
3. Before clicking "Complete assessment", check that:
   - the evidence you linked is listed,
   - no "Needed for completion" line remains,
   - the suggested level matches your rule.
4. Afterwards read back `risk` with TenantVendorGet, or check the vendor directory row.
```

## NOTES
- A real override looks the same: on another vendor, "Overridden risk level: Low" was a genuine earlier
  override that needed "Change Override". Reloading is how to tell the two apart.
- Related: `oneleet-vendor-assessments-completed-through-the-api-never-get-a-risk-level.md` (why the
  portal step is needed at all).
