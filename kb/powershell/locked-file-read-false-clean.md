---
tech: powershell
tags: [verification, false-negative, locked-file, fileshare, readallbytes, positive-control, silent-wrong-output, forensics]
severity: high
---
# A verification scan that fails to read the file reports "CLEAN"

## PROBLEM
The classic "prove the bad thing is gone" script reads a file, searches it for known-bad strings, and prints CLEAN when the hit count is zero. If the **read** fails, `$bytes` is `$null`, the search runs against nothing, the hit count is zero, and the script confidently prints **CLEAN**.

You get a false negative that looks exactly like a pass. Worse, this happens precisely on the files you most want to verify: databases and logs held open by a running service.

`[System.IO.File]::ReadAllBytes()` opens with `FileShare.Read`, so it **throws** on any file another process holds with a write lock:

    The process cannot access the file '...\wpndatabase.db' because it is being used by another process.

With `$ErrorActionPreference = 'Continue'` (the default), that exception is printed but execution continues into the search, and the script reports success on a file it never opened.

Hit live while verifying that scam toasts had been purged from the Windows notification DB (`wpndatabase.db`, held open by `WpnUserService`). The first run printed `CLEAN - no scam strings present` for all three files having read **zero bytes** from each.

## WRONG
```powershell
foreach ($f in @('wpndatabase.db','wpndatabase.db-wal','wpndatabase.db-shm')) {
  $bytes = [System.IO.File]::ReadAllBytes($fp)     # throws: file is locked by the service
  $text  = [System.Text.Encoding]::ASCII.GetString($bytes)   # $bytes is $null
  $hits  = @($needles | Where-Object { $text -match $_ })
  if ($hits.Count -eq 0) { "$f : CLEAN" }          # <-- searched NOTHING, reports CLEAN
}
```

## RIGHT
```powershell
$ErrorActionPreference = 'Stop'

function Read-LockedBytes($path) {
  # FileShare::ReadWrite lets us read a file another process holds open for writing.
  $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open,
                               [System.IO.FileAccess]::Read,
                               [System.IO.FileShare]::ReadWrite)
  try { $ms = New-Object System.IO.MemoryStream; $fs.CopyTo($ms); return $ms.ToArray() }
  finally { $fs.Dispose() }
}

$anyFail = $false
foreach ($f in $files) {
  $bytes = $null
  try { $bytes = Read-LockedBytes $fp }
  catch { "$f : READ FAILED -> $($_.Exception.Message) [RESULT INVALID]"; $anyFail = $true; continue }

  # A read that returns nothing is never evidence of cleanliness.
  if ($null -eq $bytes -or $bytes.Length -eq 0) { "$f : ZERO BYTES [RESULT INVALID]"; $anyFail = $true; continue }

  $hits = Search-Needles $bytes
  if ($hits.Count -eq 0) { "$f : read $($bytes.Length) bytes -> CLEAN" }
  else { "$f : *** FOUND $($hits -join ', ')"; $anyFail = $true }
}

# Positive control: prove the search finds a string KNOWN to be in the same file.
# Without this, "no hits" is indistinguishable from "searched nothing".
$ctrl = ([System.Text.Encoding]::ASCII.GetString((Read-LockedBytes $db)) -match 'SQLite')
if (-not $ctrl) { 'WARNING: control failed - scan cannot be trusted'; $anyFail = $true }

if ($anyFail) { 'OVERALL: INCONCLUSIVE / DIRTY' } else { 'OVERALL: VERIFIED CLEAN' }
```

## NOTES
- **Always pair a negative assertion with a positive control.** "I did not find X" is only meaningful if you can also show the same search *does* find something you know is there. This one line converts an unfalsifiable pass into real evidence.
- Report three states, not two: CLEAN / DIRTY / **INCONCLUSIVE**. Collapsing INCONCLUSIVE into CLEAN is what makes this dangerous. Never let a `catch` fall through into a success path.
- Search both `ASCII`/UTF-8 **and** `Unicode` (UTF-16LE) encodings of the buffer -- Windows toast payloads and many binary stores hold UTF-16 XML, so a UTF-8-only grep misses them.
- SQLite: also scan the `-wal` sidecar. Recently written rows may live only in the WAL and not yet in the main `.db`. Checking the `.db` alone can miss exactly the records you are looking for.
- For notification/toast DBs the file stays locked even after `Stop-Service`, because Windows restarts the per-user `WpnUserService_<id>` almost immediately. Use `FileShare::ReadWrite` rather than fighting for exclusive access.
- Related: [Error handling with -ErrorAction Stop](error-handling.md), [Don't assume catch-block operations will succeed](catch-block-safety.md).
