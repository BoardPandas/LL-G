---
tech: soc2
tags: [oneleet, vendor-management, risk-assessment, api, portal]
severity: high
---
# Oneleet vendor assessments completed through the API never get a risk level

## PROBLEM
Answering every question of a Oneleet vendor risk assessment through the API
(`TenantVendorUpdateAssessment`, plus `TenantVendorDataInventoryCreate` for data
inventory vendors) sets `isCompleted: true` and `reviewedAt`, so the assessment looks done.
But the vendor's `risk` field is never written. The portal's Vendor Directory keeps the vendor
under "Needs details", with "Continue" where the risk level should be. No API tool sets `risk`,
so a run that "completed" every vendor through the API leaves the whole list unfinished.

## WRONG
```text
TenantVendorUpdateAssessment(answers=...)   -> isCompleted: true
TenantVendorGet                              -> no "risk" key
# assume the vendor review is finished
```

## RIGHT
```text
# After the API answers, for each vendor:
1. Open /tenants/<tenant-id>/vendors/<tenant-vendor-id>/assessment in the portal
2. Under RISK LEVEL read "Suggested risk level"; use Override if it disagrees with your rating
3. Click "Complete assessment"
TenantVendorGet -> "risk": "MEDIUM"   # verify the key now exists
```

## NOTES
Detect it in the API: `isCompleted` is true but `TenantVendorGet` returns no `risk` key.
The suggested level comes from the answers and the data sensitivity. Related:
[catalog pre-fills](oneleet-vendor-assessments-show-catalog-prefills-as-answers-before-the-assessment-starts.md).
