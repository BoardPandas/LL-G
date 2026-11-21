---
tech: powershell
tags: [powershell, pwsh, com, invokemember, psobject, disp_e_typemismatch, windows-installer, join-path]
severity: high
---
# Cmdlet output passed to COM InvokeMember fails with DISP_E_TYPEMISMATCH

## PROBLEM
In PowerShell 7, COM objects that lack usable type information, such as
`WindowsInstaller.Installer`, have to be driven through
`$obj.GetType().InvokeMember(...)`. The argument array goes to IDispatch as-is.
A value that came out of a cmdlet (`Join-Path`, `Resolve-Path`, `Get-Item`, a
pipeline `$_`) is a **PSObject-wrapped** string or int, and IDispatch rejects it:
`Exception calling "InvokeMember" with "5" argument(s): "Type mismatch. (0x80020005 (DISP_E_TYPEMISMATCH))"`.

Ad-hoc testing tends to assign a literal (`$path = 'C:\x.msi'`), which is not
wrapped, so the call works locally and fails in the real script.

Worse, if the call sits in a `try/catch` that treats any failure as "not found",
the type error turns into a confident wrong answer.

## WRONG
```powershell
$msiPath = Join-Path $OutputDir 'Product.msi'          # PSObject-wrapped string
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($msiPath, 0))
# -> DISP_E_TYPEMISMATCH

1..$count | ForEach-Object { $rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, @($_)) }
# -> DISP_E_TYPEMISMATCH ($_ is wrapped too)
```

## RIGHT
```powershell
$db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @([string]$msiPath, [int]0))
1..$count | ForEach-Object { $rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, @([int]$_)) }
```

## NOTES
- Cast every argument to its plain .NET type (`[string]`, `[int]`) right where it
  goes into the `InvokeMember` array. Casting where the variable is first assigned
  does not help once the value goes through another pipeline.
- Test with the same expression the script uses (`Join-Path`, `Get-Item`), never
  with a hand-typed literal.
- Don't catch-all around COM calls to detect a missing table or row. Query for it
  (`SELECT Name FROM _Tables WHERE Name = 'Dialog'`) and let real errors through.
- Seen with PowerShell 7.5 on Windows 11 and on the GitHub `windows-latest` runner.
