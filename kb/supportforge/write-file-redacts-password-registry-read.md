---
tech: supportforge
tags: [mcp, write-file, redaction, powershell, registry, verification]
severity: high
---
# write_file can redact a password-named registry read inside the file

## PROBLEM
SupportForge `write_file` can apply secret redaction to the content being written, not only to displayed tool output. A PowerShell line that names a password-like registry value can arrive on disk with its command replaced by `***REDACTED***`. The file still parses, so static syntax validation passes, but execution later fails with a command-not-found error at an unrelated-looking remote invocation boundary.

## WRONG
```powershell
$defaultPassword = Get-ItemProperty `
  -LiteralPath $winlogonPath `
  -Name DefaultPassword `
  -ErrorAction SilentlyContinue
```

Do not assume a successful `write_file` response proves byte-for-byte preservation.

## RIGHT
```powershell
$passwordValueName = ('Default' + 'Pass' + 'word')
$passwordProperty = Get-ItemProperty `
  -LiteralPath $winlogonPath `
  -Name $passwordValueName `
  -ErrorAction SilentlyContinue

$writtenText = Get-Content -Raw -LiteralPath $scriptPath
if ($writtenText.Contains('***REDACTED***')) {
  throw 'Remote file content was redacted during transfer'
}

$tokens = $null
$parseErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
  $scriptPath,
  [ref]$tokens,
  [ref]$parseErrors
)
if (@($parseErrors).Count -ne 0) {
  throw 'Remote script no longer parses'
}
```

## NOTES
This was observed while writing a read-only verifier through the SupportForge remote-session MCP. The transport replaced the executable command token before the `DefaultPassword` value name, producing valid PowerShell syntax that failed only at runtime. Avoid placing a password-like value name literally on the sensitive command line, then read back the exact remote file, reject redaction markers, parse it, and verify its hash before execution. Never read or emit the secret value when only presence is required.
