---
tech: architecture
tags: [migration, golden-test, snapshot, fingerprint, rebase, regression]
severity: medium
---
# Golden migration fingerprints must come from the commit the migration lands on

## PROBLEM
A "nothing a reader sees changes" test compared every read mask's snapshot against fingerprints captured
before the migration. They were captured from the branch point. Meanwhile main gained two features that added
fields to every snapshot, the branch was rebased, and every fingerprint failed, for reasons unrelated to the
migration. Stripping the new fields by hand would have hidden real changes. A separate metadata-only edit also
moved a hash field (`dataVersion`) that is part of each snapshot.

## WRONG
```ts
// captured once at the old base, then the branch was rebased onto a newer main
const golden = load("fixtures/golden/series-v0.6.0.json");
const NEW_KEYS = new Set(["books", "introBooks", "scope", "progressions", "order", "dataVersion"]); // growing
```

## RIGHT
```ts
// Recapture from the exact commit the migration is rebased onto, for EVERY live dataset,
// in a throwaway worktree of that commit (node_modules symlinked), using the old code.
const golden = load(`fixtures/golden/${slug}-v0.8.2.json`);
const NEW_KEYS = new Set(["books", "introBooks", "scope"]); // only what this migration adds
// A metadata-only field that legitimately moved: substitute the captured value, do not strip it.
const snap = { ...rest, dataVersion: golden.dataVersion };
```

## NOTES
- Fingerprint (sha256 of each mask's JSON) rather than storing full snapshots: 64 masks stayed at 2 KB instead
  of 6 MB.
- Assert the mask count equals the golden's key count, so a dataset that grew a book cannot pass vacuously.
- Before a long-lived branch, check `git log <base>..origin/main` and rebase early.
