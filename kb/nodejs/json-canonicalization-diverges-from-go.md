---
tech: nodejs
tags: [json, canonicalization, signatures, crypto, go, interop, ecdsa, escaping]
severity: high
---
# JSON.stringify and Go's encoding/json disagree, so a body signed in Node verifies nowhere

## PROBLEM

Any payload that Node signs and a Go client verifies must canonicalize to identical bytes on both sides — the signature covers the bytes, not the object. `JSON.stringify` and Go's `encoding/json` escape strings differently in two places:

- **`<`, `>`, `&`** — Go escapes them to `<`, `>`, `&` by default. `JSON.stringify` never does.
- **U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR)** — Go escapes these **unconditionally**. Its source says so in as many words ("It is valid JSON to escape them, so we do so unconditionally"), citing JSONP safety. `JSON.stringify` never does.

The first is fixable with `encoder.SetEscapeHTML(false)`. **The second has no flag.** Nothing in either standard library can be configured to reconcile it.

What makes this dangerous is the failure mode, not the mismatch. A signed body containing U+2028 signs cleanly on the server, is stored, is served, and fails verification on every endpoint that receives it. The verifier reports exactly what it should — *the signature does not verify* — which is indistinguishable from a substituted payload. So the symptom is a fleet-wide integrity alert, and the investigation is of an attack that never happened. It survives every test that round-trips within one language, because each language agrees with itself.

The trigger is any free-text field inside the signed body. Enums, UUIDs, hex digests, and regex-constrained fields are already safe; one `description`, `contentType`, `filename`, or `label` that accepts arbitrary user text reopens it. U+2028 arrives more often than it looks: it survives copy-paste out of PDFs, Word, and some CMS exports, and is invisible in every editor.

## WRONG

```typescript
// Server: canonical JSON over a body with a free-text field.
export const ManifestSchema = z.object({
  artifactId: z.string().uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  contentType: z.string().min(1).max(255),  // <-- accepts anything
}).strict();

const signature = await webcrypto.subtle.sign(
  { name: 'ECDSA', hash: 'SHA-256' },
  key,
  Buffer.from(canonicalJson(manifest), 'utf8'),
);
```

```go
// Client: "the same" canonical form. Two divergences, both live.
func CanonicalJSON(m Manifest) ([]byte, error) {
    return json.Marshal(orderedMap(m))   // escapes < > & AND U+2028/U+2029
}
// contentType "text/plain; charset=utf-8" now hashes differently here
// than on the server. ecdsa.Verify returns false. Reads as tampering.
```

## RIGHT

```typescript
// Constrain the only free-text field to printable ASCII, in the schema that
// both sides compile against. This is an interop constraint, not a taste in
// media types -- say so where it lives, or someone will relax it.
export const ContentTypeSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[\x20-\x7E]+$/, 'contentType must be printable ASCII');
```

```go
// Turn off the divergence that CAN be turned off.
func encodeString(value string) ([]byte, error) {
    var buf bytes.Buffer
    enc := json.NewEncoder(&buf)
    enc.SetEscapeHTML(false)            // fixes < > &
    if err := enc.Encode(value); err != nil {
        return nil, err
    }
    return bytes.TrimRight(buf.Bytes(), "\n"), nil  // Encode appends a newline
}
```

```typescript
// Pin the exact canonical bytes as a literal in BOTH suites. This, and not
// either test alone, is what couples them.
expect(canonicalJson(sampleManifest())).toBe(
  '{"artifactId":"6f5f...","contentType":"text/plain; charset=utf-8",...}'
);
```

```go
func TestCanonicalJSONIsByteStable(t *testing.T) {
    want := `{"artifactId":"6f5f...","contentType":"text/plain; charset=utf-8",...}`
    got, _ := CanonicalJSON(sample())
    if string(got) != want {
        t.Fatalf("canonical form drifted\n got: %s\nwant: %s", got, want)
    }
}
```

## NOTES

- **Exclude at the schema, not at the encoder.** Stripping or replacing U+2028 before signing means the signed body no longer says what the caller supplied — and the value stored elsewhere in the row will differ from the value inside the manifest, which the next integrity check reports as a mismatch. Refusing the input is the only option that keeps one truth.
- **Pinning the literal in both languages is the actual control.** Each side testing its own canonicalizer against its own expectation passes forever while the two disagree. A shared generated fixture works equally well; what does not work is two independently written assertions.
- **Go's `Encoder.Encode` appends a newline** and `Marshal` does not. Trim it, or every signature is over one extra byte.
- **Numbers are a second, quieter divergence.** Route integers through `strconv.FormatInt` rather than the JSON encoder: a value that has passed through an `any`/`interface{}` becomes `float64` and marshals as `2.048e+03`.
- **Do not reach for `ecdsa.VerifyASN1` against a WebCrypto signature.** WebCrypto emits raw `r||s` (64 bytes for P-256); DER is a different encoding and `VerifyASN1` will reject every valid signature. Parse the halves and call `ecdsa.Verify`.
- Same class as any cross-language digest: the bug is never in the crypto, it is in the bytes handed to it.
