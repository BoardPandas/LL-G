---
tech: graph-api
tags: [teams, sharepoint, permissions, private-channels]
severity: medium
---
# Site permissions and channel permissions are separate

## PROBLEM
Adding someone to a Teams private channel does NOT automatically grant SharePoint site access. The user can chat in the channel but may not be able to access files. This is because private channels have their own separate SharePoint sites.

## WRONG
```powershell
# Assumes channel membership = file access
Add-MgTeamChannelMember -TeamId $teamId -ChannelId $channelId -BodyParameter @{
    "@odata.type" = "#microsoft.graph.aadUserConversationMember"
    "user@odata.bind" = "https://graph.microsoft.com/v1.0/users('$userId')"
    roles = @("member")
}
# User can chat but gets "Access Denied" on files
```

## RIGHT
```powershell
# After adding channel member, verify file access
Add-MgTeamChannelMember -TeamId $teamId -ChannelId $channelId -BodyParameter @{
    "@odata.type" = "#microsoft.graph.aadUserConversationMember"
    "user@odata.bind" = "https://graph.microsoft.com/v1.0/users('$userId')"
    roles = @("member")
}

# Check drive permissions before write operations
$ctx = Get-MgContext
if ($ctx.Scopes -notcontains "Sites.ReadWrite.All" -and $ctx.Scopes -notcontains "Files.ReadWrite.All") {
    Write-Warning "Missing write permissions. File operations will fail."
}
```

## NOTES
- Private channels have their own SharePoint site, separate from the parent team
- Standard channels share the team's SharePoint site -- permissions are inherited
- Use `Get-MgTeamChannelFileFolder` to get the correct drive reference for any channel type
- See also `private-channels.md` in `kb/graph-api/` for the drive access pattern
