---
tech: go
tags: [redaction, secrets, streaming, overlapping-matches, security, false-green]
severity: high
---
# Sequential redactors can invalidate each other's matches and leak fragments

## PROBLEM

A pipeline that applies known-secret replacement and generic credential-pattern
replacement sequentially is not necessarily safer than either filter alone.
The first replacement changes the text the second detector needs to recognize.

Both orders can leak:

- Known values first: if a known value is `Password`, replacing it in
  `Password=other-secret` removes the label the generic credential rule needs.
  The unknown credential survives beside a reassuring redaction marker.
- Generic patterns first: a known value `Password=first\nsecond-secret` becomes
  `Password=[REDACTED]\nsecond-secret`. The exact multiline matcher can no
  longer find its value, so its second line is published unchanged.

Tests of each redactor in isolation pass. The output contains `[REDACTED]`, so a
test that only asserts the marker exists also passes. The leak is in the
composition and requires intersecting fixtures to reproduce.

## WRONG

```go
// This order exposes the second line of a known multiline credential.
output := credentialPattern.ReplaceAllString(input, "Password=[REDACTED]")
output = strings.ReplaceAll(output, knownSecret, "[REDACTED]")

// Reversing the order is not a general fix: knownSecret might be the label
// or delimiter the generic expression needs to recognize.
```

## RIGHT

Run every detector against the same original text. Collect the ranges that
must be withheld, take their union, then render redaction markers once.

```go
mask := make([]bool, len(input))
hide := func(start, end int) {
    for i := start; i < end; i++ { mask[i] = true }
}
// Mark ALL known-value occurrences, including overlaps, on input.
// Mark generic credential matches and private-key ranges on input too.
// Never mutate input between these detection passes.
for _, match := range credentialPattern.FindAllStringIndex(input, -1) {
    hide(match[0], match[1])
}
var output strings.Builder
for i := 0; i < len(input); {
    if !mask[i] { output.WriteByte(input[i]); i++; continue }
    output.WriteString("[REDACTED]")
    for i < len(input) && mask[i] { i++ }
}
```

Use valid text and match boundaries that preserve the encoding. If a prior
normalization removes terminal controls or escapes characters, derive matching
forms for that representation as well.

## NOTES

- Regression tests must assert the sensitive fragments are absent, not merely
  that some redaction marker exists. Test known values that coincide with a
  generic label and multiline values intersecting a generic match.
- Streaming adds a separate boundary: retain enough suffix to recognize a
  known value split across writes, do not split a known multiline occurrence
  at a flush boundary, and withhold incomplete tails after truncation. Union
  masking solves composition; it cannot recover text already published.
- Apply byte/event/pending-buffer caps before retaining arbitrary output.
- Generic patterns cannot recognize every unknown sensitive value. This is
  defense in depth alongside an authoritative known-secret snapshot and access
  controls, not a universal secret detector.
- Reproduced and fixed while building SupportForge RMM-028's Go execution
  foundation in `governed_shell_output.go`. The regression tests cover both
  orders: `TestGovernedShellKnownValueCannotEraseGenericCredentialDetection`
  and `TestGovernedShellGenericDetectionCannotSplitKnownMultilineSecret`.
