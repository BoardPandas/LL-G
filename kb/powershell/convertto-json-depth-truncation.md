---
tech: powershell
tags: [json, convertto-json, depth, truncation, chromium, edge, preferences, silent-data-loss, read-modify-write]
severity: high
---
# ConvertTo-Json truncates at -Depth 2 by default and silently destroys nested config files

## PROBLEM
`ConvertTo-Json` defaults to `-Depth 2`. Anything nested deeper is not serialized as JSON -- each object below the limit is replaced with the *literal string* of its type name, usually `"System.Object[]"`.

The failure is silent and passes every naive sanity check:
- Windows PowerShell 5.1 emits **no warning and no error**.
- The output is still **syntactically valid JSON**, so it survives `ConvertFrom-Json`.
- The file still "looks like" the original at the top level.

This makes the standard read-modify-write pattern on real config files destructive. Chromium/Edge `Preferences` is ~1.2 MB and 12 levels deep; Chrome/Edge `Local State`, `appsettings.json`, `launch.json`, Teams/Slack configs and most SDK manifests all nest well past 2. Removing one bad key and writing back with a default-depth `ConvertTo-Json` silently wipes the user's browser profile while reporting success.

Discovered while removing malicious web-push notification grants from an Edge `Preferences` file during a scareware cleanup.

## WRONG
```powershell
$j = Get-Content $prefs -Raw | ConvertFrom-Json
$j.profile.content_settings.exceptions.notifications.PSObject.Properties.Remove($badOrigin)

# -Depth defaults to 2. Everything deeper is now the string "System.Object[]".
# No error. Valid JSON. Profile destroyed.
$j | ConvertTo-Json | Set-Content $prefs
```

## RIGHT
```powershell
# Read as UTF-8 explicitly (Get-Content -Raw uses the ANSI codepage in 5.1 and mangles non-ASCII).
$raw = [System.IO.File]::ReadAllText($prefs, [System.Text.Encoding]::UTF8)
$j   = $raw | ConvertFrom-Json

$j.profile.content_settings.exceptions.notifications.PSObject.Properties.Remove($badOrigin)

$out = $j | ConvertTo-Json -Depth 100 -Compress

# Gate the write. Any one of these catches a truncated serialize before it hits disk.
if ($out -match 'System\.Object\[\]')             { throw 'ABORT: depth truncation detected' }
if ($out -match 'System\.Management\.Automation') { throw 'ABORT: PSObject leakage detected' }
try { $null = $out | ConvertFrom-Json } catch     { throw 'ABORT: output will not re-parse' }
if ($out.Length -lt ($raw.Length * 0.9))          { throw 'ABORT: output suspiciously small' }

# Chromium will not parse a BOM. UTF8Encoding($false) = no BOM.
[System.IO.File]::WriteAllText($prefs, $out, (New-Object System.Text.UTF8Encoding($false)))
```

## NOTES
- **Prove the round-trip before you modify anything.** Serialize the *unmodified* object at `-Depth 100`, re-parse it, and assert the top-level key count and your target subtree both survive. If a no-op round-trip is not lossless, an edit never will be. On a real 1.2 MB Edge `Preferences` this confirmed 154/154 top-level keys preserved and actual max nesting depth of only 12, so `-Depth 100` was ample.
- `-Depth 100` is cheap insurance; measure real depth only if you need to justify it. PowerShell 7 warns on truncation, 5.1 does not -- never rely on the warning.
- The `"System.Object[]"` string is the single highest-signal fingerprint. Grepping output for it is a one-line regression test.
- Related: [Array safety with @() wrapping](array-safety.md), [Member enumeration on an array returns every element's value](member-enumeration-concatenation.md).
- For Edge/Chrome specifically, the write is only durable if the browser is fully stopped first -- see `kb/windows/edge-push-notification-scareware-cleanup.md`.
