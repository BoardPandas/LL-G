---
tech: nodejs
tags: [tls, mtls, x509, certificate, serial-number, getPeerCertificate, postgres, lookup]
severity: high
---
# A peer certificate's serialNumber drops leading zero bytes, so a stored-hex lookup misses 1 in 256

## PROBLEM
`tlsSocket.getPeerCertificate().serialNumber` and `crypto.X509Certificate#serialNumber` report the serial as an integer in uppercase hex, with leading zero bytes removed. An issuer that generates 16 random bytes and stores them as 32 lowercase hex digits therefore sees about 1 certificate in 256 (first byte `00`) arrive two digits short.

A lookup that only lowercases the presented serial never matches those certificates. Every request is refused as an unknown certificate. Renewal is refused as well, because it authenticates with the same lookup, so the device stays locked out until the certificate expires. The handshake succeeds, the other 255 of 256 devices work, and the server logs only "unknown serial", so it reads as a broken device. In production this kept one agent offline for a week.

There is a side effect too. Any code that finds "the certificate being presented" by the same lookup, such as superseding it on re-enrollment, silently skips those certificates, so they linger as active.

## WRONG
```ts
const serial = socket.getPeerCertificate().serialNumber; // '443D8C...' (30 digits)
await db.query('SELECT ... FROM device_certificates WHERE serial = lower($1)', [serial]);
// stored: '00443d8c...' (32 digits), so no row: UNKNOWN_CERTIFICATE forever
```

## RIGHT
```ts
const SERIAL_HEX_DIGITS = 32; // the width your issuer writes
function serialLookupForms(serial: string): string[] {
  const lower = serial.toLowerCase();
  return [...new Set([lower, lower.padStart(SERIAL_HEX_DIGITS, '0')])];
}
await db.query('SELECT ... FROM device_certificates WHERE serial = ANY($1::text[])',
  [serialLookupForms(serial)]); // still uses the unique index on serial
```

## NOTES
- Do not wrap the column in a function (`ltrim(serial, '0')`). That defeats the unique index and causes a sequential scan on every mTLS request.
- `padStart` never truncates, so a serial longer than the stored width cannot be mapped onto a different row.
- Pin it with a test that mints a certificate whose serial starts with `00`, reads Node's own `serialNumber`, and resolves it. A test with a hand-typed uppercase serial cannot catch this.
- To find affected rows: `WHERE serial ~ '^00' AND status = 'active'`.
