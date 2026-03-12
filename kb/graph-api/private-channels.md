---
tech: graph-api
tags: [teams, channels, private, sharepoint, drive, file-folder]
severity: high
---
# Private channels have separate SharePoint sites

## PROBLEM
Private channel files are not stored in the parent team's SharePoint site. They live in a completely separate SharePoint site created specifically for that private channel. Trying to access private channel files through the team's main drive silently returns nothing or the wrong folder.

## WRONG
```powershell
# BAD -- assumes private channel files are in the team's main drive
$teamDrive = Get-MgTeamDrive -TeamId $teamId
# Navigate from there... finds no private channel files
```

## RIGHT
```powershell
# GOOD -- get the private channel's own file folder directly
$privateChannels = Get-MgTeamChannel -TeamId $teamId | Where-Object { $_.MembershipType -eq 'private' }
foreach ($channel in $privateChannels) {
    $folder = Get-MgTeamChannelFileFolder -TeamId $teamId -ChannelId $channel.Id
    # $folder.ParentReference.DriveId is the private channel's own drive
    $driveItems = Get-MgDriveItemChildren -DriveId $folder.ParentReference.DriveId -DriveItemId $folder.Id
}
```

## NOTES
- Standard and shared channels use the parent team's main SharePoint site
- Private channels get their own site at a URL like `https://tenant.sharepoint.com/sites/TeamName-ChannelName`
- Site permissions for private channels are also separate -- adding someone to the Teams channel doesn't automatically grant SharePoint site access. May need to grant both.
- `Get-MgTeamChannelFileFolder` returns the correct drive reference regardless of channel type -- use it consistently rather than navigating from the team drive.
