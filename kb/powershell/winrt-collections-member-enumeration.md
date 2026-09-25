---
tech: powershell
tags: [powershell, winrt, ocr, collections]
severity: medium
---
# WinRT collections in Windows PowerShell 5.1: .Count and [0] do not do what they look like

## PROBLEM
WinRT vectors returned from Windows APIs (for example `OcrResult.Lines`, `OcrLine.Words`) do not behave like arrays in Windows PowerShell 5.1. `$result.Lines.Count` member-enumerates and prints `1 1 1 ...` instead of a count, and `$line.Words[0].BoundingRect.X` yields an object array, so casting it to `[int]` throws `Cannot convert the "System.Object[]" value`. Separately, running WinRT OCR as SYSTEM straight from a OneDrive placeholder path failed with no output, while the same image copied to a temp file worked.

## WRONG
```powershell
"$($result.Lines.Count) lines"                 # prints 1 1 1 1 ...
$x = [int]$line.Words[0].BoundingRect.X        # throws: System.Object[] to Int32
```

## RIGHT
```powershell
$rows = foreach ($line in $result.Lines) {
  $words = @(); foreach ($w in $line.Words) { $words += $w }
  [pscustomobject]@{ X = [int]$words[0].BoundingRect.X; T = [string]$line.Text }
}
"$(@($rows).Count) lines"
```

## NOTES
Copy WinRT collections into PowerShell arrays with foreach before indexing or counting. Wrap each step in try/catch that prints the message; the failing call otherwise surfaces only as exit status 1.
