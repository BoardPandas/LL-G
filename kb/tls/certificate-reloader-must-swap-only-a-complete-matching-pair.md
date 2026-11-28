---
tech: tls
tags: [certificate, renewal, hot-reload, private-key, atomic-rename, race, lets-encrypt, acme]
severity: medium
---
# A certificate renewer writes key and chain non-atomically relative to each other, so a reloader can load a mismatched pair

## PROBLEM
A renewal replaces two files: the private key and the certificate chain. Even when each file is written atomically (write a temporary file, rename it into place), the **pair** is not: there is a moment when one file is new and the other is old. A server that watches the files and reloads on change can read the new chain with the old key, or half of a file that is still being written. Depending on the TLS library it then fails to load, or loads and fails handshakes, and keeps doing so until the next change.

## WRONG
```text
on file change:
    key   = read(key_path)
    chain = read(chain_path)
    server.set_certificate(chain, key)      # whatever was on disk at that instant
```

## RIGHT
```text
Reloader:
    a = (read(key_path), read(chain_path))
    b = (read(key_path), read(chain_path))
    if a != b:                         retry later     # files were changing while read
    if !parses(a) or !key_matches_leaf(a):  keep the current pair, retry later
    server.set_certificate(a)                          # only a complete, matching pair

Renewer (deploy hook):
    rename the new key into place first, then the chain
```

## NOTES
- "Read identically twice" catches a file being rewritten during the read; the key-matches-certificate test catches the window between the two renames.
- On any doubt the reloader keeps serving the pair it already has; a failed reload must never leave the server without a certificate.
- Trigger the reload on the chain (the file renamed last), so the key is already in place when it fires.
