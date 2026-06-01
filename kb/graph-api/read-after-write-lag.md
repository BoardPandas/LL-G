---
tech: graph-api
tags: [users, patch, read-after-write, eventual-consistency, replication, jobtitle, update-mguser, verification]
severity: medium
---
# Graph user PATCH then immediate GET returns stale value (read-after-write lag)

## PROBLEM
After `Update-MgUser` (PATCH /users/{id}) succeeds with no error, reading the same property straight back with `Get-MgUser` can return the OLD value. The GET is served by a Graph replica that has not yet caught up with the write. The giveaway is an inconsistent split: in a bulk loop some accounts read the new value and others read the stale one, even though every PATCH returned success. Treating the immediate read-back mismatch as a failed write leads you to "retry" writes that already worked, or to report false failures. Re-reading the same accounts a few seconds later shows the correct value for all of them.

## WRONG
```powershell
foreach ($u in $targets) {
    Update-MgUser -UserId $u.Id -JobTitle $u.NewTitle
    # Immediate read-back from a possibly-stale replica:
    $check = Get-MgUser -UserId $u.Id -Property jobTitle
    if ($check.JobTitle -ne $u.NewTitle) {
        Write-Warning "FAILED: $($u.UPN)"   # false alarm -- write actually succeeded
        # ...needless retry logic fires here...
    }
}
```

## RIGHT
```powershell
# Trust the PATCH: if Update-MgUser throws, it failed; if it returns, it succeeded.
$changed = @()
foreach ($u in $targets) {
    Update-MgUser -UserId $u.Id -JobTitle $u.NewTitle   # throws on real failure
    $changed += $u
}

# If you must verify, do it as a SEPARATE pass after a short delay so replicas converge.
Start-Sleep -Seconds 30
foreach ($u in $changed) {
    $check = Get-MgUser -UserId $u.Id -Property jobTitle
    if ($check.JobTitle -ne $u.NewTitle) { Write-Warning "Still stale (recheck): $($u.UPN)" }
}
```

## NOTES
- This is the existing-object update analogue of [exo-directory-lag-after-graph-create.md](exo-directory-lag-after-graph-create.md), which covers EXO recipient cmdlets failing right after user *creation*. Here the object already exists and Graph itself serves a stale read of a freshly PATCHed property.
- Observed bulk-updating ~34 user `jobTitle` values; ~13 read back stale immediately, all correct ~45s later.
- A `Start-Sleep` of 30-60s before verification is usually enough. Do not add per-write retries on the GET -- you would be re-patching values that already persisted.
