---
tech: typescript
tags: [base64, binary, file-transfer, offsets, integrity]
severity: high
---
# Base64 character counts skip bytes in chunked transfers

## PROBLEM
A transfer loop that advances its byte offset with `Math.floor(base64.length * 3 / 4)` overcounts padded chunks. A 65,536-byte chunk encodes to 87,384 characters ending in `==`, so this calculation advances 65,538 bytes. The next read skips two source bytes. A small, single-chunk file appears to work; larger transfers silently corrupt data, and progress counters still look plausible.

## WRONG
```typescript
offset += Math.floor(chunk.data.length * 3 / 4);
```

## RIGHT
```typescript
const decoded = atob(chunk.data);
const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
await appendVerifiedChunk(bytes);
offset += bytes.byteLength;
```

## NOTES
Validate each chunk hash, require the final byte count to equal the declared size, and compare the complete SHA-256 before publishing a staged destination. Test multiple padded 64 KiB chunks and a short final chunk, asserting both requested offsets and exact round-trip bytes. Browser `atob` returns a binary string, so its length also gives the byte count; UTF-8 text decoding does not. Node callers can use `Buffer.from(data, 'base64').byteLength`.

Discovered while implementing SupportForge RMM-030. A regression test now covers 196,615 bytes, chunk tampering, premature EOF, cancellation, and final checksum refusal.
