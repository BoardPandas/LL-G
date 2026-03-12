---
tech: graph-api
tags: [teams, channels, naming, rate-limits, migration]
severity: medium
---
# Channel display name restrictions and rate limits

## PROBLEM
Teams channel names have strict validation rules that the API enforces silently or with unhelpful errors. Bulk Teams operations also hit rate limits quickly.

## WRONG
```powershell
# Unsanitized name with disallowed characters
New-MgTeamChannel -TeamId $teamId -DisplayName "Q1 Report: Sales & Marketing (50% growth!)"

# Bulk operations without rate limiting
foreach ($channel in $channels) {
    New-MgTeamChannel -TeamId $teamId -DisplayName $channel.Name
    # 429 throttling after a few calls
}
```

## RIGHT
```powershell
# Sanitize channel name
$safeName = $channelName -replace '[~#%&*{}+/\\:<>?|''"]', '' | ForEach-Object { $_.Trim() }
if ($safeName.Length -gt 256) { $safeName = $safeName.Substring(0, 256) }
New-MgTeamChannel -TeamId $teamId -DisplayName $safeName

# Add delay between bulk operations
foreach ($channel in $channels) {
    New-MgTeamChannel -TeamId $teamId -DisplayName $channel.SafeName
    Start-Sleep -Milliseconds 500
}
```

## NOTES
- Max 256 characters
- No leading or trailing whitespace
- Disallowed characters: `~ # % & * { } + / \ : < > ? | ' "`
- Teams Graph API has stricter rate limits than most Graph endpoints
- 500ms delay between operations is a safe default for bulk channel/member operations
