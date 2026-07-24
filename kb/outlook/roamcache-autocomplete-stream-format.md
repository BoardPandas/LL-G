---
tech: outlook
tags: [autocomplete, roamcache, nickname-cache, mapi, binary, powershell, nk2]
severity: medium
---
# Parsing the Outlook AutoComplete (RoamCache) stream without NK2Edit

## PROBLEM
Since Outlook 2010 the AutoComplete / nickname cache is not an .NK2 file; it is a mailbox stream mirrored on disk at %LOCALAPPDATA%\Microsoft\Outlook\RoamCache\Stream_Autocomplete_*.dat. To dump it in PowerShell you must know the binary layout, and three things are non-obvious and each yields zero or garbage rows if guessed wrong: the header size, where the UTF-16 length sits relative to the property tag, and that the length includes the trailing null.

## WRONG
```powershell
# Assuming classic MAPI serialization: tag(4) immediately followed by cb(4) then data.
# The length is NOT right after the tag, so this reads a nonsense cb -> 0 rows, no error.
# (tag at offset j)
$cb  = [int]$b[$j+4] + [int]$b[$j+5]*256   # WRONG offset for the RoamCache stream
```

## RIGHT
```powershell
# Layout of Stream_Autocomplete_*.dat:
#   Header: 16 bytes, starts with magic 0D F0 AD BA (0xBAADF00D).
#   Then per entry: a 4-byte property count, then that many properties.
#   Each property: [tag 4][reserved 4 = 00 00 00 00][field 8][cb 4][UTF-16LE data, cb bytes INCLUDING trailing 0x0000]
#   tag is little-endian: PT_UNICODE type 0x001F -> bytes 1F 00, then propId low,high.
$b = [IO.File]::ReadAllBytes($dat)
# ...locate a tag at $j where $b[$j] -eq 0x1F -and $b[$j+1] -eq 0 ...
$cb  = [int]$b[$j+16] + [int]$b[$j+17]*256 + [int]$b[$j+18]*65536 + [int]$b[$j+19]*16777216
$val = [Text.Encoding]::Unicode.GetString($b, $j+20, $cb-2)   # cb-2 drops the trailing null
# Useful propIds: 0x6001 nickname/dropdown (starts each entry - good row delimiter),
#   0x3001 DisplayName, 0x3A20 TransmittableDisplayName, 0x3002 AddrType,
#   0x3003 EmailAddress/routing (EX for internal recipients), 0x39FE SmtpAddress, 0x3A00 Account.
```

## NOTES
The .dat file itself is the re-importable artifact: copy it into a new profile's RoamCache with Outlook closed to restore autocomplete. For a readable export, group properties into rows delimited by 0x6001 and prefer 0x3001 > 0x3A20 > 0x6001 for the display name and 0x39FE > 0x3003 for the address. Completeness backstop: also regex every UTF-16 email string across both byte parities. Watch the [byte] bitwise-truncation trap when computing tag/cb (see the PowerShell -bor/-shl entry). Note the agent context: SupportForge runs as SYSTEM, so live Outlook COM is unavailable and you must parse the on-disk stream (or pull contacts via Graph).
