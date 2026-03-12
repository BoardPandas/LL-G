---
tech: graph-api
tags: [authentication, disconnect, finally, cleanup, connect-mggraph]
severity: high
---
# Always Disconnect-MgGraph in finally block

## PROBLEM
If a script connects to Graph and then throws an exception, the session stays open. Stale connections accumulate, can cause token conflicts on the next run, and leave auth state unpredictable.

## WRONG
```powershell
Connect-MgGraph -TenantId $tid -ClientId $cid -CertificateThumbprint $thumb -NoWelcome
$users = Get-MgUser -All  # throws? connection stays open forever
```

## RIGHT
```powershell
try {
    Connect-MgGraph -TenantId $tid -ClientId $cid -CertificateThumbprint $thumb -NoWelcome
    # ... all operations inside the try block ...
    $users = Get-MgUser -All
} finally {
    Disconnect-MgGraph -ErrorAction SilentlyContinue
}
```

## NOTES
- `-ErrorAction SilentlyContinue` on disconnect is intentional -- if there's no active connection, `Disconnect-MgGraph` throws. The `finally` block should never itself throw.
- This pattern applies to `Connect-ExchangeOnline` too: wrap in try/finally and call `Disconnect-ExchangeOnline` in the finally block.
