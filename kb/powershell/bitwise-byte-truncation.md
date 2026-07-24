---
tech: powershell
tags: [bytes, bitwise, binary-parsing, type-coercion, shl, bor]
severity: high
---
# Bitwise -bor / -shl on [byte] operands silently truncates to a byte

## PROBLEM
Combining bytes into a wider integer with PowerShell bitwise operators keeps the [byte] type and truncates the result to 8 bits, with no error. Building a 16-bit value from two bytes as `$b[$i+2] -bor ($b[$i+3] -shl 8)` discards the high byte: for 0x6001 you get 0x01. Every downstream comparison or hashtable lookup silently misses, the loop finds nothing, and the script "succeeds" with empty output. No exception is thrown and StrictMode does not catch it, so it looks like your data or byte offsets are wrong, not your arithmetic. Cost hours on a binary-parse task where a hashtable keyed by 0x3001 / 0x39FE never matched.

## WRONG
```powershell
# $b is a [byte[]]. Intent: 16-bit little-endian value from two bytes.
$propId = $b[$i+2] -bor ($b[$i+3] -shl 8)   # -> low byte only; 0x6001 becomes 0x01
$cb     = $b[$i+16] -bor ($b[$i+17] -shl 8) -bor ($b[$i+18] -shl 16) -bor ($b[$i+19] -shl 24)
```

## RIGHT
```powershell
# Cast each byte to [int] first, OR use plain integer arithmetic (no truncation).
$propId = [int]$b[$i+2] + [int]$b[$i+3] * 256
$cb     = [int]$b[$i+16] + [int]$b[$i+17]*256 + [int]$b[$i+18]*65536 + [int]$b[$i+19]*16777216
# Equivalent with bitwise, forcing int width:
# $propId = ([int]$b[$i+2]) -bor (([int]$b[$i+3]) -shl 8)
```

## NOTES
Same trap applies to -band / -bxor and to -shl past bit 7 on any [byte]. Comparisons (-eq / -ne) and array indexing are fine because they coerce to int; only the arithmetic/bitwise result inherits the [byte] type. Verify by printing the intermediate: `"{0:x}" -f $propId`. Common trigger: parsing [byte[]] from [IO.File]::ReadAllBytes for binary formats (Outlook RoamCache, MAPI streams, etc.).
