---
tech: powershell
tags: [word, com, pdf, xps, sensitivity-labels, purview]
severity: high
---
# Word COM PDF export hangs under mandatory sensitivity labels

## PROBLEM
In a Microsoft 365 tenant with **mandatory sensitivity labeling** (Purview), automating Word through COM and calling `$doc.ExportAsFixedFormat($pdf, 17)` (17 = `wdExportFormatPDF`) never returns. Word raises a label / PDF-protection modal on a hidden, non-interactive instance, so nobody can answer it: the call blocks forever, `WINWORD.EXE` stays running, and the script hangs silently. No exception, no event-log entry, no partial file. `DisplayAlerts = 0` and a read-only open do not suppress it.

It looks like a slow machine or a large document, so the usual reaction is to raise a timeout, which just hangs longer. Every document in the tenant is affected, including freshly generated ones.

A second trap in the cleanup path: from PowerShell, `$word.Quit(0)` throws, so the `finally` block fails and the hidden `WINWORD.EXE` is orphaned (and keeps the file locked for the next run).

## WRONG
```powershell
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open($docx)
$doc.ExportAsFixedFormat($pdf, 17)   # wdExportFormatPDF: blocks forever on the hidden label modal
$word.Quit(0)                        # throws from PowerShell; WINWORD.EXE is left running
```

## RIGHT
```powershell
# Export XPS (no label modal, ~1 s), then convert XPS -> PDF outside Office.
$ErrorActionPreference = 'Stop'
$word = $null; $doc = $null
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0                                   # wdAlertsNone
    # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
    $doc = $word.Documents.Open($docx, $false, $true, $false)
    $doc.ExportAsFixedFormat($xps, 18)                        # 18 = wdExportFormatXPS
}
finally {
    if ($null -ne $doc)  { $doc.Close(0) | Out-Null }         # wdDoNotSaveChanges
    if ($null -ne $word) {
        $word.Quit()                                          # NO arguments -- Quit(0) throws and orphans WINWORD
        [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null
    }
}
# Trust the file, not the exit code.
if (-not (Test-Path -LiteralPath $xps) -or (Get-Item -LiteralPath $xps).Length -eq 0) {
    throw "Word wrote no XPS: $xps"
}
```

```python
# XPS -> PDF with PyMuPDF (pip install pymupdf)
import pymupdf
with pymupdf.open(xps_path) as xps:
    pdf_bytes = xps.convert_to_pdf()
with open(pdf_path, "wb") as fh:
    fh.write(pdf_bytes)
# then assert pdf_path exists and is non-empty
```

## NOTES
- Diagnose quickly: if `WINWORD.EXE` is still alive after the export call and the PDF never appears, it is the modal, not the document. Kill the orphan before retrying, or the next run hits a locked file.
- Office caches the tenant's label policy (label names and GUIDs) under `%LOCALAPPDATA%\Microsoft\Office\CLP\*.gz`. Reading it gives you the real label IDs, which you can stamp into a generated .docx (`docMetadata/LabelInfo.xml`) so the file opens in Word without a mandatory-label prompt at all.
- PyMuPDF can also rasterize the resulting PDF (`page.get_pixmap(dpi=...)`) for a visual check of every page.
- Related: `set-label-container-settings-discarded.md` (another Purview label behaviour that fails silently from PowerShell).
