---
tech: godot
tags: [fileaccess, encryption, gut, testing, godot4]
severity: medium
---
# Opening a FileAccess.open_encrypted file with the wrong key prints an engine ERROR that fails GUT tests

## PROBLEM
Decrypting an `open_encrypted` file with the wrong key prints an engine `ERROR:` (MD5 mismatch) before returning null, and GUT 9.7 fails any test that prints an engine error.
The null return looks like a clean, handled failure, but the log line still fails the test and any harness that rejects `ERROR:` lines.

## WRONG
```gdscript
var f := FileAccess.open_encrypted(path, FileAccess.READ, key)
if f == null:
	return ""  # engine ERROR already printed
```

## RIGHT
```gdscript
# Put a key fingerprint in the file name; never decrypt a file made with another key.
var name := "session-%s.bin" % key.hex_encode().sha256_text().left(16)
var path := dir.path_join(name)
if not FileAccess.file_exists(path):
	return ""
var f := FileAccess.open_encrypted(path, FileAccess.READ, key)
```

## NOTES
Godot 4.7.2, GUT 9.7.1. `assert_engine_error` can expect the error in GUT, but other harnesses grepping for `ERROR:` still fail; avoiding the decrypt is cleaner. Delete files with other fingerprints unread.
