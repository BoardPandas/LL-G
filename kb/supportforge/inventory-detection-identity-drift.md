---
tech: supportforge
tags: [macos, go, software-deployment, inventory, detection, identity, testing]
severity: high
---
# Inventory and deployment detection disagree on the identity of the same application

## PROBLEM

Scheduled inventory and fresh deployment detection read the same operating-system
application report but normalize identity independently. Inventory publishes
`app:/applications/tool.app`; deployment detection returns `/Applications/Tool.app`.
An exact rule copied from inventory cannot match on the endpoint. The server may
skip the device using its stored inventory while a queued endpoint job installs
again or reports NOT_DETECTED_AFTER_INSTALL after a successful install. Missing
paths amplify the divergence when only one mapper synthesizes a fallback.

Both components look reasonable in isolation. A JSON regression test that decodes
into a test-local struct proves the fixture, not either production mapper.

## WRONG

```go
// Scheduled inventory:
item.ItemKey = "app:" + strings.ToLower(app.Path)
// Fresh endpoint detection:
candidate.ItemKey = app.Path
```

## RIGHT

```go
// Both production consumers use the same parser and identity mapping.
items, err := inventory.ParseMacInstalledSoftware(report)
if err != nil { return nil, err }
for _, item := range items {
    candidates = append(candidates, DetectionCandidate{
        ItemKey: item.ItemKey, Name: item.Name,
    })
}
```

Preserve the already-persisted inventory identity. Test a rule derived from the
real inventory parser against the real endpoint candidate conversion and job
handler. Cover skip-before-install, absent-to-present confirmation, version
floors, user/system copies with the same name, and missing-path fallback. A
missing or null report list is an error, while an explicit empty array can be
valid evidence. Detection must remain fresh; share the mapper, not a stale cache.

## NOTES

Found while reviewing SupportForge issues #141 and #190 on 2026-09-08. Regression
tests reproduced canonical-key and fallback mismatches before the fix. No live
fleet installation was used to establish this finding. Check existing raw-path
rules before adopting the canonical inventory identity on older endpoints.

Keep the parser and tests in files without a GOOS suffix so every CI platform
executes them. This complements the sanitizer-stripped-attribute lesson: here
both values survive, but two producers give the same item different identities.
