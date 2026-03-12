---
tech: powershell
tags: [error-handling, catch, try-catch, resilience]
severity: medium
---
# Don't assume catch-block operations will succeed

## PROBLEM
When a `try` block fails, the `catch` block often attempts a fallback operation (e.g., querying for an existing resource instead of creating one). If that fallback also throws, the original error is lost and the script crashes with an unrelated message.

## WRONG
```powershell
try {
    $sp = New-MgServicePrincipal -AppId $appId
} catch {
    if ($_.Exception.Message -match "already exists") {
        $sp = Get-MgServicePrincipal -Filter "appId eq '$appId'"  # This can also fail!
    } else { throw }
}
```

## RIGHT
```powershell
try {
    $sp = New-MgServicePrincipal -AppId $appId
} catch {
    if ($_.Exception.Message -match "already exists") {
        try {
            $sp = Get-MgServicePrincipal -Filter "appId eq '$appId'"
        } catch {
            Write-Error "Could not create or find service principal: $($_.Exception.Message)"
            exit 1
        }
    } else { throw }
}
```

## NOTES
- Always consider: "what if this fallback also fails?" -- especially for network calls
- If the catch-block fallback is critical, wrap it in its own `try/catch`
- Provide a clear error message that includes context from both the original and fallback failures
