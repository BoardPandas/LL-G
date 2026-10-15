---
tech: architecture
tags: [timestamps, java, javascript, validation, serialization, canonicalization, data-loss]
severity: high
---
# Canonical timestamp comparisons can reject valid producer output

## PROBLEM
A consumer can parse a valid producer timestamp and still reject it because its
own serializer chooses a different spelling. Java
`Instant.ofEpochMilli(...).toString()` omits the fractional part at an exact
second. JavaScript `Date.parse()` accepts that value, but `toISOString()` prints
`.000Z`. Requiring the serialized string to equal the input rejects the valid
whole-second value.

This can be silent data loss rather than an obvious validation error. If a
reconciler treats the rejected optional field as missing and writes a replacement
manifest, the original start time becomes `null`. A completed job then looks as
though it never started. Most timestamps contain nonzero milliseconds, so ordinary
fixtures pass and only exact-second values expose the mismatch.

Strict canonical input is useful when a request contract requires it. The mistake
is assuming that another runtime's documented output uses that same spelling.

## WRONG
```js
const produced = "2030-06-07T08:09:10Z";
const ms = Date.parse(produced); // A valid instant.
const startedAt = Number.isFinite(ms) && new Date(ms).toISOString() === produced
  ? produced
  : null;

// Reconciliation now replaces the source evidence with null.
const replacementManifest = { engineStartedAt: startedAt };
```

## RIGHT
```js
// Keep the existing strict request contract.
function canonicalRequestMillis(value) {
  if (typeof value !== "string" || value.length > 32) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}

// Only for this known producer: UTC Instant strings derived from epoch millis.
function normalizeWriterTimestamp(value) {
  if (canonicalRequestMillis(value) !== null) return value;
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const canonical = `${value.slice(0, -1)}.000Z`;
  return canonicalRequestMillis(canonical) === null ? null : canonical;
}
```

The adapter accepts the producer's whole-second spelling and returns the
consumer's canonical representation. Its round-trip check still rejects calendar
rollover, hour 24 and leap seconds. The explicit null comparison preserves the
Unix epoch: a parsed millisecond value of `0` is valid, not a missing value.

## NOTES
- Verify the actual producer clock and formatter. The observed writer used
  `System.currentTimeMillis()` followed by `Instant.ofEpochMilli(...).toString()`,
  so its fractional precision was zero or three digits. Do not generalize that to
  every Java `Instant`: a different clock or constructor can carry finer precision.
  This adapter rejects unsupported precision, including six or nine fractional
  digits, instead of silently truncating it. Define an explicit precision policy
  before supporting another producer.
- Apply the adapter at every boundary that reads those writer fields: live
  progress, writer-stop detection and final manifest reconciliation. Fixing only
  the progress reader leaves the same value vulnerable to a later overwrite.
  Preserve terminal-state guards, including checks inside queued mutations, so
  late metadata cannot reopen or rewrite settled state.
- Normalize before hashing the newly finalized representation. Do not rewrite
  settled archives or their checksums merely to make historical counters agree.
  If the original absolute timestamp has already been lost, leave it unknown;
  creation time, result arrival and monotonic event offsets do not establish the
  exact start time. A separately verified terminal result may prove that work
  started for an aggregate count without fabricating a timestamp.
- Test exact seconds, nonzero milliseconds, epoch zero, valid leap days, invalid
  calendar dates, hour 24, leap seconds, unsupported fractions, offsets and
  non-string values. Also test the complete progress-to-settlement path, closed
  manifests, late or queued progress, and unchanged bytes and hashes for settled
  artifacts. Keep request-validator tests separate to prove its contract did not
  broaden accidentally.
- This complements [the invalid-calendar rollover lesson](../typescript/date-constructor-rolls-over-impossible-dates.md):
  parse success alone is too permissive, while full-string equality against a
  different producer's serializer can be too restrictive. Also see
  [hash the persisted JSON representation](../typescript/hash-persisted-json-representation.md).
- Verified in a Java-to-Node diagnostic pipeline on 2026-10-15. Whole-second
  metadata caused a completed job to be omitted from the started count; regression
  tests now cover the scoped adapter, lifecycle boundaries and preservation of
  historical null values and artifact evidence.
