---
tech: godot
tags: [fileaccess, encryption, aes, md5, security, godot4]
severity: high
---
# FileAccess.open_encrypted_with_pass keys AES-256 on an MD5 hex string

## PROBLEM
`open_encrypted_with_pass` uses `pass.md5_text()` (32 hex characters) as the AES-256 key, so the key has only 128 bits of material whatever passphrase you supply.
The API name and AES-256 suggest a full-strength derivation; nothing warns otherwise.

## WRONG
```gdscript
var f := FileAccess.open_encrypted_with_pass(path, FileAccess.WRITE, OS.get_unique_id())
```

## RIGHT
```gdscript
var key: PackedByteArray = ("app-context:" + OS.get_unique_id()).sha256_buffer()  # 32 bytes
var f := FileAccess.open_encrypted(path, FileAccess.WRITE, key)
```

## NOTES
Godot 4.7.2. `OS.get_unique_id()` is empty on Linux without `/etc/machine-id` (some containers); disable the feature rather than encrypt with an empty key.
