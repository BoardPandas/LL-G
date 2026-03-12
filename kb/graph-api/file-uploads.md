---
tech: graph-api
tags: [files, upload, sharepoint, onedrive, large-files, upload-session]
severity: medium
---
# Large file uploads need upload sessions (over 4MB)

## PROBLEM
Direct PUT to a Drive item's `/content` endpoint fails for files over 4MB with a `413 Request Entity Too Large` error. Large files must use the upload session API.

## WRONG
```powershell
# BAD -- fails for files over 4MB
$content = [System.IO.File]::ReadAllBytes($localPath)
Invoke-MgGraphRequest -Method PUT -Uri "$driveUri/content" -Body $content -ContentType "application/octet-stream"
```

## RIGHT
```powershell
$fileSize = (Get-Item $localPath).Length

if ($fileSize -gt 4MB) {
    # Create upload session
    $session = Invoke-MgGraphRequest -Method POST -Uri "$itemUri/createUploadSession" -Body @{}
    $uploadUrl = $session.uploadUrl

    # Upload in chunks (256KB - 60MB per chunk, must be multiple of 320KB)
    $chunkSize = 5MB
    $fileStream = [System.IO.File]::OpenRead($localPath)
    $buffer = New-Object byte[] $chunkSize
    $offset = 0
    while (($read = $fileStream.Read($buffer, 0, $chunkSize)) -gt 0) {
        $end = $offset + $read - 1
        $headers = @{ 'Content-Range' = "bytes $offset-$end/$fileSize" }
        Invoke-WebRequest -Uri $uploadUrl -Method PUT -Body $buffer[0..($read-1)] -Headers $headers
        $offset += $read
    }
    $fileStream.Close()
} else {
    # Direct upload OK for small files
    $bytes = [System.IO.File]::ReadAllBytes($localPath)
    Invoke-MgGraphRequest -Method PUT -Uri "$driveUri/content" -Body $bytes -ContentType "application/octet-stream"
}
```

## NOTES
- 4MB is the hard limit for direct PUT. Use upload sessions for anything close to that limit to be safe.
- Chunk size must be a multiple of 320KB. The upload session URL expires after a period of inactivity -- don't pause between chunks.
- File copy between drive locations (not upload from disk) uses the async `copy` endpoint: `POST /drives/{id}/items/{id}/copy`. Returns 202 with a `Location` header for monitoring progress.
