---
tech: nodejs
tags: [node-postgres, pg, ssl, sslmode, tls, connection-string]
severity: medium
---
# `sslmode=require` in a pg connection string overrides your `ssl` options

## PROBLEM
node-postgres parses `sslmode` from the URL, and current versions treat `require`,
`prefer` and `verify-ca` as `verify-full`. That URL setting wins over the `ssl` object
you pass, so `ssl: { rejectUnauthorized: false }` is ignored and the connection fails
with "self-signed certificate in certificate chain". `psql` with the same URL works,
which makes the URL look fine. Hosted Postgres proxies (Railway, and similar) commonly
hand out URLs with `sslmode=require`.

## WRONG
```ts
new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
// DATABASE_URL=...?sslmode=require  -> self-signed certificate in certificate chain
```

## RIGHT
```ts
const url = String(process.env.DATABASE_URL)
  .replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '')
new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
```

## NOTES
pg prints a "SECURITY WARNING" about the sslmode aliases before it fails. That warning
is the clue. Prefer supplying the server's CA (`ssl: { ca }`) over disabling
verification when the provider publishes it.
