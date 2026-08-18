---
tech: architecture
tags: [validation, data-ingest, parsing, reconciliation, silent-failure, invariants, spreadsheet, etl]
severity: high
---
# A conservation check cannot detect a misread source -- both sides derive from it

## PROBLEM

A pipeline that reads a file and persists records is usually validated with
**conservation** checks: rows in equals rows out, the file's total equals the
stored total, `rowsRead === rowsEmitted + skipped`. Each of those compares two
quantities computed from **the same read of the source**.

So none of them can detect a wrong read. Wrong header row, wrong sheet, wrong
delimiter, wrong offset, wrong encoding -- every equation still balances
perfectly, because both sides inherited the identical mistake. The pipeline
reports green while persisting records that are empty or wrong in every field
that matters.

Observed: an XLSX whose first row is a merged title banner, parsed at header row
0. The banner became the only column name, the real header row was stored as
data, and four records persisted with null customer, null identifier and null
amount. Every control passed -- 4 read, 4 emitted, 4 persisted, audit invariant
held -- and the report was marked `reconciled`. The one genuine line in the file
was never stored. Two such reports sat in production undetected, three weeks of
which were *after* a full reconciliation suite shipped specifically to prove
nothing was being lost.

Three compounding traps:

1. **Conservation is the wrong shape of check.** You need a *fitness* check:
   does the parsed shape actually support the records you claim to produce?
2. **A coverage ratio does not work as that fitness check.** "How many mapped
   columns were found?" scored **100%** on both bad reports -- their single
   mapped column genuinely existed, it was just the title banner. Key on a
   **named required field**, not a percentage.
3. **A check that cannot run must not fall silent.** The value comparison
   disabled itself precisely when the read failed (no amount column resolved ->
   total was `null` -> the comparison was skipped, and the UI omitted the row
   entirely). Silence rendered identically to success.

## WRONG

```ts
// Every assertion below compares two numbers derived from the SAME read,
// so the one thing that can actually be wrong is the one thing unchecked.
const { headers, rows, audit } = parseSheet(bytes, { headerRow: 0 });
const records = rows.map((r) => applyColumnMap(r, columnMap));

assert(audit.rowsRead === audit.rowsEmitted + audit.skipped);  // balances
assert(records.length === persistedCount);                     // balances

// ...and the value check disables itself exactly when the read failed:
const fileTotal = sumColumn(rows, columnMap.amount?.header);   // header absent -> null
if (fileTotal !== null && Math.abs(fileTotal - storedTotal) >= 0.01) {
  warn("totals disagree");
}
// fileTotal === null -> no comparison, no warning, nothing rendered.
// The page shows "4 rows read, 4 stored, 0 skipped" and looks perfect.
```

## RIGHT

```ts
// 1. FITNESS: does the parsed shape support the records we claim to produce?
//    Keyed on a NAMED required field -- never a coverage ratio, which scores
//    100% when the one mapped column happens to be the title banner.
const amountHeader = columnMap.amount?.header;
if (!amountHeader || !headers.map((h) => h.trim()).includes(amountHeader.trim())) {
  // Fail loudly, and make the message actionable: what we read, what we found
  // there, and where the real header probably is.
  throw new UnusableSourceError(
    `No amount column. Read sheet "${sheet}", header row ${headerRow + 1}; ` +
      `headers found: ${headers.join(", ") || "none"}. ` +
      `Row ${suggestHeaderRow({ headers, rows, sourceRowNumbers }) + 1} looks like the real header row. ` +
      `Nothing was stored.`,
  );
}

// 2. KEEP the conservation checks. They catch a different, real class (dropped
//    rows). Fitness and conservation are complements, not substitutes.
assert(audit.rowsRead === audit.rowsEmitted + audit.skipped);

// 3. A check that CANNOT run must say so, never go quiet. "Not comparable" is
//    information; an omitted row reads as "fine".
render(
  fileTotal === null
    ? "Total: not comparable -- no amount column was mapped"
    : formatMoney(fileTotal),
);
```

## NOTES

- **Where to put the guard.** Run it *before* any destructive step. A reprocess
  that deletes the previous records and then fails leaves nothing; guarding
  first means a bad re-read cannot destroy a good prior run.
- **Fail vs warn, by what survives.** Nothing usable (no required field) ->
  fail, persist nothing. Some non-essential columns missing but the required
  field intact -> warn and keep going; a 99%-correct batch is worth far more
  than a failed one.
- **Never auto-correct the read.** Suggesting "row 4 looks like the header" in
  an error message is useful. Silently re-parsing at a guessed offset trades
  one quiet wrong answer for another.
- **Corollary bug, found while fixing this one:** the "which row is the real
  header?" hint must count **source** rows, not indices into the emitted array.
  Skipped blank rows break that correspondence -- the file had a blank line
  above its header, so index-plus-offset pointed at the blank line, and the
  remediation instructions would have produced another empty batch.
- **A trailing total row is the same bug one stage on.** A statement's own total
  line read as a data row doubles the batch, and the value check still agrees,
  because the raw column sum contains the same duplicate.
- Generalizes past spreadsheets: any decoder whose framing is a parameter
  (CSV delimiter, fixed-width offsets, JSON root path, XML namespace, text
  encoding) has this property. Test the *meaning* of what you decoded, not just
  that you counted it consistently.
- Related: `precondition-gate-counts-unfiltered-collection.md` and
  `derived-signal-goes-constant.md` -- same family, a check that structurally
  cannot observe the failure it appears to guard.
