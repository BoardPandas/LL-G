---
tech: graph-api
tags: [teams, channels, async, provisioning, sharepoint, file-folder]
severity: medium
---
# Channel creation is async -- poll before accessing files

## PROBLEM
`New-MgTeamChannel` returns as soon as the channel record is created, but the underlying SharePoint file folder provisioning is asynchronous. Attempting to access `Get-MgTeamChannelFileFolder` immediately after creation returns a 404.

## WRONG
```powershell
$channel = New-MgTeamChannel -TeamId $teamId -DisplayName "Projects" -MembershipType "standard"
$driveItem = Get-MgTeamChannelFileFolder -TeamId $teamId -ChannelId $channel.Id
# 404 -- file folder not provisioned yet
```

## RIGHT
```powershell
$channel = New-MgTeamChannel -TeamId $teamId -DisplayName "Projects" -MembershipType "standard"

# Poll until the file folder is ready
$maxWait = 120
$elapsed = 0
do {
    Start-Sleep -Seconds 5
    $elapsed += 5
    try {
        $driveItem = Get-MgTeamChannelFileFolder -TeamId $teamId -ChannelId $channel.Id
        break  # success
    } catch {
        if ($elapsed -ge $maxWait) {
            Write-Error "Channel file folder not ready after ${maxWait}s"
            return
        }
    }
} while ($true)
```

## NOTES
- Standard channels typically provision in 10-30 seconds. Private channels take longer and have separate SharePoint sites. See `private-channels.md`.
- Channel display names have restrictions: max 256 chars, no leading/trailing whitespace, no `~ # % & * { } + / \ : < > ? | ' "`. Sanitize before creation.
- The same polling pattern applies to other async Graph operations (e.g., group provisioning, app role assignment propagation).
