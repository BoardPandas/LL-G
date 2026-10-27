---
tech: graph-api
tags: [message-trace, messagetraces, exchange-online, service-principal, 403, propagation, retry, exchangemessagetrace, beta]
severity: high
---
# Graph message trace 403s until you provision Microsoft's trace service principal, then keeps 403ing intermittently while it propagates

## PROBLEM
The beta Graph message trace API (`GET /admin/exchange/tracing/messageTraces`) returns 403 "Service principal-less Authentication failed: the service principal for App ID <trace-app-id> was not found" until that Microsoft app's service principal exists in the tenant. After you create it, the identical 403 keeps coming back on a random share of calls for a long while, even though other calls succeed.

`<trace-app-id>` is Microsoft's first-party app (display name "Transport Data Platform"). Its App ID is printed in the 403 text itself and listed in Microsoft's "provision a service principal" section of the Graph message trace documentation.

Three things make this hard to read:

1. The calling app can hold broad Graph consent and still get it. The 403 is about a Microsoft first-party app missing from the tenant, not about your app's permissions. Generic "a 403 means missing admin consent" advice sends you the wrong way.
2. Your app also needs the Graph application role `ExchangeMessageTrace.Read.All`, which older app registrations will not have.
3. After provisioning, the first 200 makes it look done. A bulk pull then loses a third or more of its query windows to the same "not found" text, which reads as if the service principal had been deleted. Code that catches errors and returns an empty set under-counts silently.

Observed on a live tenant in October 2026. The first success came about 30 minutes after creating the service principal (immediately after granting the role), and intermittent 403s continued for at least another 25 minutes. Microsoft's documentation says provisioning "may take several hours".

## WRONG
```powershell
New-MgServicePrincipal -AppId $traceAppId
# one test call succeeds, so run the full pull
foreach ($w in $windows) {
    try   { $rows += (Invoke-MgGraphRequest -Method GET -Uri $w.Uri).value }
    catch { }   # a propagation 403 becomes "no mail in this window"
}
```

## RIGHT
```powershell
# $traceAppId: the App ID quoted in the 403 message (Microsoft's "Transport Data Platform" app)

# 1. Provision once per tenant
$sp = Get-MgServicePrincipal -Filter "appId eq '$traceAppId'"
if (-not $sp) { $sp = New-MgServicePrincipal -AppId $traceAppId }

# 2. Grant the calling app's service principal the Graph application role
#    ExchangeMessageTrace.Read.All (an appRoleAssignment on Microsoft Graph).

# 3. Retry only this specific 403, per window, and refuse to report on a partial pull
$done = @{}
foreach ($w in $windows) {
    for ($try = 1; ; $try++) {
        try {
            $done[$w.Key] = Invoke-MgGraphRequest -Method GET -Uri $w.Uri -ErrorAction Stop
            break
        } catch {
            $msg = "$($_.ErrorDetails.Message) $($_.Exception.Message)"
            if ($msg -match 'Service principal-less Authentication failed' -and $try -lt 8) {
                Start-Sleep -Seconds (30 * $try); continue
            }
            throw
        }
    }
}
if ($done.Count -ne $windows.Count) { throw "Trace pull incomplete: $($done.Count)/$($windows.Count) windows" }
```

## NOTES
- Track completion per query window (date range plus filter), not per batch. Re-issuing the same failing call worked within one or two retries each time.
- On an older tenant, confirm `ExchangeMessageTrace.Read.All` exists on the tenant's Microsoft Graph service principal before assigning it; see graph-api/stale-graph-sp-app-roles.
- Creating the service principal and assigning the role are both tenant writes; treat the role assignment as a privileged change.
- Related: graph-api/graph-message-trace-ignores-endswith-senderaddress-and-returns-the-whole-tenant (the sender filter that silently does nothing), and exchange-online/get-messagetracev2-10-day-cap for the 10-day query limit this API shares.
