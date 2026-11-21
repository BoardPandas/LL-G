---
tech: soc2
tags: [soc2, oneleet, vendor-risk, vendor-assessment, catalog, prefill, dpa]
severity: high
---
# Oneleet vendor assessments show catalog pre-fills as answers before the assessment starts

## PROBLEM
For a vendor whose risk assessment has never been saved, Oneleet's `TenantVendorGetAssessment` (and the
`data` embedded in `TenantVendorList`) returns the vendor's catalog template with values already in each
item's `answer` field. They look like saved answers, but they are Oneleet's catalog defaults, not anything the
tenant confirmed, and `isCompleted` is still false.

Submitting them as-is carries the catalog's mistakes into the audit record. In one tenant, 6 of 11 pre-filled
vendors had `time_to_notify: "none"` ("No formal commitment", HIGH risk), although their DPAs commit to
notifying "without undue delay" ("As required by contract", LOW). Pre-fills also disagreed with each other for
vendors on the same DPA, and one marked MFA "required" where the vendor only makes it available.

## WRONG
```js
// Fill only the blanks and keep everything already "answered"
const q = await get("TenantVendorGetAssessment", { "tenant-vendor": id });
const answers = Object.fromEntries(q.items.filter(i => i.answer == null).map(i => [i.id, guess(i)]));
await update("TenantVendorUpdateAssessment", { "tenant-vendor": id, answers }); // catalog values ride along
```

## RIGHT
```js
// Treat every pre-filled value as unverified; send the full answer set you sourced
const q = await get("TenantVendorGetAssessment", { "tenant-vendor": id });
const answers = {};
for (const item of q.items.filter(i => i.applicable && !i.disabledInTemplate)) {
  answers[item.id] = sourcedAnswer(vendor, item.id); // DPA / trust page / tenant config, cited
}
await update("TenantVendorUpdateAssessment", { "tenant-vendor": id, answers });
```

## NOTES
- `isCompleted: false` with non-null answers is the signal: the vendor's assessment was never saved.
- Check breach notification against the vendor's DPA. GDPR Art. 33(2) requires processors to notify "without
  undue delay", so "No formal commitment" is rarely right for a vendor with a GDPR DPA.
- The MFA question has two LOW-risk "yes" options. Decide whether you are answering the vendor's default or
  your tenant's enforced setting, and apply it consistently.
