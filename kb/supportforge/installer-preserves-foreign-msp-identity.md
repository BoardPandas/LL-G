---
tech: supportforge
tags: [windows, installer, enrollment, tenant-identity, msp, powershell, false-success]
severity: high
---
# An MSP installer can preserve another MSP's identity and still report success

## PROBLEM

A deployment script embeds the intended MSP's enrollment key but seeds config.json
only when the file is absent. The MSI marks that file Permanent and NeverOverwrite,
so even a full uninstall can leave it behind. Agent startup also restores identity
from a registry backup before enrolling, and enrollment runs only when clientId is
empty. The new key can therefore be correct and never participate in enrollment.

The updated service connects, authenticates, submits tickets and receives AI replies
under the old MSP. The technician sees neither the device nor the ticket in the
intended tenant. A ticket unexpectedly numbered 1 can be the first public number in
the old MSP's separate counter, not a fabricated success message or a reset counter.
Checking only installed version and service state reports a false success.

## WRONG

```powershell
if (-not (Test-Path $configPath)) {
    # Seed the intended MSP's enrollment key.
    Write-EnrollmentSeed
} else {
    Write-Host 'Existing config file found; preserving client identity.'
}
Install-Agent
if ((Get-Service SupportForgeAgent).Status -eq 'Running') { exit 0 }
```

```go
if cfg.ClientID == "" { cfg.restoreIdentityFromBackup() }
if cfg.ClientID == "" && cfg.EnrollKey != "" { cfg.enroll() }
```

## RIGHT

Distinguish a same-tenant upgrade from an explicit enrollment request. Resolve the
intended tenant through authenticated server logic, compare it with the effective
saved identity, and report a mismatch before declaring success. If ownership cannot
be verified, report that uncertainty. Require the expected organization and a fresh
server-side heartbeat in the final verification, not merely a running service.

An intentional cross-MSP transfer needs coordinated handling of the old fingerprint
binding, device token, command-token cache, registry backup and mTLS certificates.
Do not delete config.json and retry blindly: the backup can restore the old identity,
and the server's foreign-fingerprint guard should reject an unapproved transfer.
Preserve that guard. Move a misrouted ticket through a separately scoped repair that
also handles its board, public numbering and associated records.

## NOTES

Confirmed on 2026-09-20 using the supplied deployment script, endpoint startup logs,
the code at the shipped agent commit, and read-only production queries. The script's
fallback key resolved to the intended MSP, while the same fingerprint, active
heartbeat, active certificate and saved ticket belonged to the prior MSP. No
cross-tenant recovery was performed as part of this diagnosis.

Read the actual script used: a newer external script had removed the repository
template's blanket skip-if-installed block but retained its identity-preservation
bug. It also passed ORG_NAME while the MSI declared ORG. Verify the producer and
consumer property names, and never print an MSI argument string containing an
enrollment key into deployment logs.
