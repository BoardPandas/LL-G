---
tech: powershell
tags: [bash, shell, command-flag, inline-script, variable-expansion, temp-file]
severity: high
---
# Never pass complex scripts inline via -Command from bash

## PROBLEM
When running PowerShell from bash (e.g., Claude Code's shell, Git Bash, WSL), bash expands `$variables`, `!`, and backticks before PowerShell ever sees them. Boolean literals like `$false`, `$true`, `$null` become empty strings. This is silently wrong with no error -- the script runs but with corrupt values.

## WRONG
```bash
# BAD -- bash expands $false to empty string before PowerShell runs
powershell.exe -NoProfile -Command "Set-Mailbox -Identity '[redacted]' -HiddenFromAddressListsEnabled $false"
# PowerShell receives: Set-Mailbox -Identity '[redacted]' -HiddenFromAddressListsEnabled
# Missing value causes parameter binding error or wrong behavior
```

## RIGHT
```bash
# GOOD -- write a temp .ps1 file, execute with -File, clean up
cat > /tmp/run.ps1 << 'PSEOF'
Set-Mailbox -Identity '[redacted]' -HiddenFromAddressListsEnabled $false
PSEOF
powershell.exe -NoProfile -ExecutionPolicy Bypass -File /tmp/run.ps1
rm /tmp/run.ps1
```

```powershell
# In PowerShell itself (if already in a PS session), use a temp file for complex inline scripts:
$script = @'
Set-Mailbox -Identity '[redacted]' -HiddenFromAddressListsEnabled $false
'@
$tmpFile = [System.IO.Path]::GetTempFileName() + ".ps1"
Set-Content -Path $tmpFile -Value $script -Encoding UTF8
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmpFile
Remove-Item $tmpFile -ErrorAction SilentlyContinue
```

## NOTES
Characters bash corrupts in `-Command` strings:
- `$name` -- expanded as bash variable (almost always empty or wrong value)
- `$false`, `$true`, `$null` -- expanded as bash variables (become empty string)
- `!` -- bash history expansion
- Backticks -- bash command substitution
- Mixed quotes -- bash closes the outer string early

**Rule: Any PowerShell run from bash that uses PS variables, booleans, or multi-line logic must go through a temp `.ps1` file.**
