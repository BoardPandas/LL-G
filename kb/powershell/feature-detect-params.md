---
tech: powershell
tags: [sdk, parameters, feature-detection, graph]
severity: medium
---
# Feature-detect SDK parameters before using them

## PROBLEM
PowerShell SDK versions add parameters over time. Using a parameter that doesn't exist on the installed version crashes the script with a confusing error about unexpected arguments.

## WRONG
```powershell
# Crashes on older SDK versions that don't have this parameter
Connect-MgGraph -AdditionalAuthorizationParameters @{ login_hint = $email }
```

## RIGHT
```powershell
# Feature-detect first, then conditionally add
$connectParams = @{
    TenantId             = $tid
    ClientId             = $cid
    CertificateThumbprint = $thumb
}

if ((Get-Command Connect-MgGraph).Parameters.ContainsKey('AdditionalAuthorizationParameters')) {
    $connectParams['AdditionalAuthorizationParameters'] = @{ login_hint = $email }
}

Connect-MgGraph @connectParams
```

## NOTES
- This applies to any cmdlet, not just `Connect-MgGraph`
- Use `(Get-Command <CmdletName>).Parameters.ContainsKey('<ParamName>')` as the detection pattern
- Splatting (`@params`) makes conditional parameter addition clean
