---
tech: graph-api
tags: [teams, sharepoint, files, copy, async, migration]
severity: medium
---
# File copy between channels is async and folder-unaware

## PROBLEM
The Graph API copy endpoint (`POST /drives/{id}/items/{id}/copy`) returns HTTP 202 with a `Location` header for monitoring -- it does not complete synchronously. Also, only files can be copied; folders must be recreated manually in the target.

## WRONG
```powershell
# Trying to copy a folder -- silently fails or errors
$body = @{ parentReference = @{ driveId = $targetDriveId; id = $targetFolderId }; name = "MyFolder" }
Invoke-MgGraphRequest -Method POST -Uri "/v1.0/drives/$driveId/items/$folderId/copy" -Body $body

# Assuming copy completes synchronously
$copy = Invoke-MgGraphRequest -Method POST -Uri "/v1.0/drives/$driveId/items/$fileId/copy" -Body $body
# $copy is empty -- it's a 202, not 200
```

## RIGHT
```powershell
# 1. List source folder structure recursively
# 2. Create matching folders in target (top-down)
# 3. Copy files into the correct target folders
$body = @{
    parentReference = @{
        driveId = $targetDriveId
        id      = $targetFolderId
    }
    name = $fileName
}
Invoke-MgGraphRequest -Method POST -Uri "/v1.0/drives/$sourceDriveId/items/$sourceItemId/copy" -Body $body
# Returns 202 with Location header for monitoring progress
```

## NOTES
- The SDK cmdlet `Copy-MgDriveItem` handles the async monitoring
- For files over 4MB, use upload sessions instead of copy (see `file-uploads.md`)
- When migrating channels: recreate folder tree first, then copy files one by one
- Add small delays between copy operations to avoid 429 throttling
