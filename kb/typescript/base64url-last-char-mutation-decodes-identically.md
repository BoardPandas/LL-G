---
tech: typescript
tags: [base64url, crypto, hmac, tokens, atob, webcrypto, vitest, flaky-test, malleability]
severity: high
---
# Mutating the last base64url character often decodes to the identical bytes

## PROBLEM

Unpadded base64url packs 6 bits per character, but a byte string whose length is not a
multiple of 3 does not end on a 6-bit boundary. The final character then carries fewer
than 6 significant bits, and the leftovers are padding that `atob` **silently discards**
rather than requiring to be zero. Several distinct strings therefore decode to identical
bytes:

| Bytes | `len % 3` | Chars | Significant bits in final char | Spellings per value |
|---|---|---|---|---|
| 32 (HMAC-SHA256) | 2 | 43 | 4 | **4** |
| 16 (a 128-bit nonce) | 1 | 22 | 2 | **16** |
| 33, 48, … | 0 | — | 6 | 1 |

Two things break, and both are silent.

**1. "Tamper the last character" is not reliably a tamper.** The idiom
`token.slice(0, -1) + "X"` is everywhere in signature tests. A canonical encoder only
ever emits a final character whose alphabet index is a multiple of 4 (for a 32-byte
value), and `X` is index 23, so the mutation is swallowed whenever the real signature
ends in `U` (index 20) — `23 >> 2 === 20 >> 2`. The token is not corrupted, it is the
same credential re-spelled, so verification **correctly succeeds** and the test fails.
Measured over 2000 real HMACs: **125/2000 = 6.25%, exactly 1/16.** For a 16-byte value
the same idiom is a no-op **1 time in 4**.

This presents as a rare flaky test that looks like a clock race or a runner bug, and it
sends you auditing the verify path — which is fine. Worse is the case where it does not
flake: a fixed-clock unit test with a lucky payload passes forever while asserting
nothing, and the day someone edits the fixture it silently starts (or stops) testing.

**2. Tokens are malleable.** One credential has up to 16 valid string spellings. That is
not forgery — you cannot produce a token you did not already hold — but it breaks
anything that keys on the raw token *text*: a single-use nonce ledger, an idempotency
key, a dedup set, a revocation list, a cache key. Re-spell the token and the replay
guard sees a value it has never burned.

## WRONG

```ts
// --- the decoder: accepts every spelling ---
export function b64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);           // discards the slack bits, no complaint
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;              // "…U" and "…X" both return the SAME 32 bytes
  } catch {
    return null;
  }
}

// --- the test that believes it corrupts a signature ---
const good = await mintToken(SECRET, claims, now);
const tampered = `${good.slice(0, -1)}X`;        // a no-op 1 run in 16
expect((await fetch(`/a/${tampered}`)).status).toBe(403);
// AssertionError: expected 200 to be 403     <- ~6% of runs, "unreproducible"

// --- and a loop, so the failure never says WHICH token leaked ---
for (const t of [tampered, expired, foreign, "a.garbage.garbage"]) {
  expect((await fetch(`/a/${t}`)).status).toBe(403);
}
```

## RIGHT

```ts
// 1. Make the decoder reject non-canonical spellings. Canonical iff re-encoding
//    reproduces the input exactly -- one credential, one string.
//    No timing concern: this compares the caller's own input against a re-encoding
//    of that same input, so there is no secret in the comparison.
export function b64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return b64urlEncode(out) === value ? out : null;   // <-- the whole fix
  } catch {
    return null;
  }
}

// 2. In tests, mutate the FIRST character. It is always fully significant, so this
//    always changes byte 0.
const [prefix, payload, sig] = token.split(".") as [string, string, string];
const tampered = `${prefix}.${payload}.${sig[0] === "A" ? "B" : "A"}${sig.slice(1)}`;

// 3. Label each case, so a failure names which token was accepted -- that distinction
//    is what decides "bug in the fixture" vs "bug in the verify path".
for (const [label, token] of cases) {
  const res = await fetch(`/a/${token}`);
  expect(res.status, `${label} token was not refused`).toBe(403);
}

// 4. Pin the collision itself, deterministically -- no looping for a 1-in-16 repro.
//    index+1 is a different character over identical bytes, because the encoder can
//    only emit a final character whose index is a multiple of 4.
const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const last = sig[sig.length - 1] as string;
expect(B64URL.indexOf(last) % 4).toBe(0);
const respelled = `${prefix}.${payload}.${sig.slice(0, -1)}${B64URL[B64URL.indexOf(last) + 1]}`;
expect(respelled).not.toBe(token);
expect((await fetch(`/a/${respelled}`)).status).toBe(403);   // fails 100% before the fix
```

## NOTES

- **Diagnosing it.** A flaky signature test whose failure rate sits near 1/16, 1/4, or
  1/64 is this, not a clock race. Confirm without a loop: re-spell a *valid* token by
  bumping its final character one index and assert the rejection. That test fails
  deterministically while the bug exists, which is how you prove the mechanism against
  the real code rather than arguing it from the encoding.
- **Decide whether the malleability is exploitable before you call it a vulnerability.**
  Check every place a token string is used as a key — nonce ledger, idempotency store,
  cache key, dedup set. If the ledger burns a nonce read out of the *decoded, verified*
  payload and the cache keys on resource identity, malleability grants nothing and the
  finding is hardening, not an incident. Say which it is.
- Same shape in any language whose base64 decoder ignores trailing bits — Python's
  `base64.urlsafe_b64decode`, Go's `base64.RawURLEncoding` (Go 1.x does *not* validate
  these bits), and most hand-rolled JWT segment decoders. JWT `alg`/`kid` hardening
  guides rarely mention it because it is not a forgery primitive.
- Canonicality is worth asserting on the ENCODER too if you ever accept base64url from
  outside: `b64urlEncode(b64urlDecode(v)!) === v` is the whole property.
- Related: [Vitest mocks of Drizzle queries need a thenable .where()](vitest-drizzle-thenable-mock.md)
  — same family of "the test passes while testing nothing".
