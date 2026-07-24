---
tech: supportforge
tags: [write_file, file-transfer, base64, checksum, integrity, endpoint]
severity: medium
---
# Landing a local file on an endpoint via write_file: chunk it and verify

## PROBLEM
SupportForge's only inbound primitive is write_file, whose content must be authored in the tool call. Transferring a file therefore means base64-ing it and pasting the blob into write_file. Reproducing a single large blob (~8 KB base64) verbatim is unreliable: one base64 character got duplicated in transit, giving a length that was not a multiple of 4, so [Convert]::FromBase64String threw "Invalid length for a Base-64 char array or string" - and an earlier attempt had already written a 0-byte file, after which a cleanup step deleted the payload. write_file itself is faithful (2 KB chunks wrote exact byte counts); the corruption was in reproducing the long string.

## WRONG
```powershell
# One giant base64 string -> single write_file -> decode.
# One dropped/duplicated char = mod-4 failure and a silent 0-byte output file.
$b64   = (Get-Content 'C:\Windows\Temp\big.b64' -Raw)
$bytes = [Convert]::FromBase64String($b64)   # "Invalid length for a Base-64 char array or string"
```

## RIGHT
```bash
# Local: gzip + base64, split into ~2 KB chunks, record each chunk SHA256 and the final file md5.
gzip -c file.csv | base64 -w0 | tr -d '\n' > c.b64
split -n 4 c.b64 ck_
for f in ck_*; do sha256sum "$f"; done        # expected per-chunk hashes
md5sum file.csv                               # expected final hash
```
```powershell
# Endpoint: write each chunk with its own write_file, verify each chunk SHA256 against expected,
# concatenate in order, [Convert]::FromBase64String, gunzip, then confirm final md5 == source.
# A single corrupted chunk is caught and re-sent; the final md5 proves byte-exactness.
```

## NOTES
Chunk small enough to reproduce reliably (~2 KB base64) and always verify: per-chunk SHA256 pinpoints the bad chunk, and a final md5 == source proves the whole transfer. gzip first (CSV compresses ~10x) to shrink the payload. Also: idle SupportForge sessions drop after ~10 min, so heavy local processing between remote calls can force a reconnect (connect_agent again). Related: the cross-session output and near-full-disk heartbeat entries.
