---
tech: graph-api
tags: [teams, chats, protected-apis, billing, 412]
severity: high
---
# /chats/getAllMessages and /users/{id}/chats/getAllMessages return 412 without Teams Protected APIs onboarding

## PROBLEM
The Graph endpoints that bulk-stream all chat messages -- `/me/chats/getAllMessages`, `/users/{id}/chats/getAllMessages`, `/chats/getAllMessages` -- return:

> 412 Precondition Failed

unless the calling tenant has been onboarded to Microsoft Teams **Protected APIs** with an active billing model (model A = per-API call, model B = per-user license / E5 + Teams Premium). Adding `?model=B` to the URL is necessary but NOT sufficient -- the tenant itself must be enrolled. For most tenants without that enrollment, these endpoints are unusable from delegated OR app-only contexts.

## WRONG
```powershell
# 412 even with delegated user-context auth
Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/me/chats/getAllMessages?$top=50' -Headers $h
# 412 even with model=B
Invoke-RestMethod -Uri 'https://graph.microsoft.com/v1.0/me/chats/getAllMessages?model=B&$top=50' -Headers $h
```

## RIGHT
Enumerate per-chat instead. Two API calls instead of one, but no Protected APIs requirement:

```powershell
# 1. List the user's chats
$chats = @()
$next = 'https://graph.microsoft.com/v1.0/me/chats?$top=50'
while ($next) {
    $r = Invoke-RestMethod -Uri $next -Headers $h
    $chats += $r.value
    $next = $r.'@odata.nextLink'
}

# 2. For each chat, page its messages
foreach ($chat in $chats) {
    $next = "https://graph.microsoft.com/v1.0/chats/$($chat.id)/messages?`$top=50"
    while ($next) {
        $r = Invoke-RestMethod -Uri $next -Headers $h
        # process $r.value
        $next = $r.'@odata.nextLink'
    }
}
```

## NOTES
- Per-chat enumeration works in delegated context with just `Chat.Read` -- no Protected APIs onboarding needed.
- `/me/chats?$top=50` returns chats brandon participates in. Chats where you were never a member are invisible.
- `$expand=members` on `/me/chats` is unreliable -- can return malformed responses on some tenants. Fetch members per-chat instead if needed.
- App-only access to chat messages (`Chat.Read.All` application permission) ALSO requires Protected APIs onboarding -- this is not just a getAllMessages restriction.
- The official escape hatch for tenant-wide chat search without Protected APIs is **eDiscovery / Purview Content Search**, scoped to Teams locations. Slower setup but works without the billing prerequisite.
- Reference: https://learn.microsoft.com/en-us/graph/teams-licenses
