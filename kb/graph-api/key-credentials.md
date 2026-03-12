---
tech: graph-api
tags: [certificates, key-credentials, update-mgapplication, encoding]
severity: high
---
# KeyCredentials: use cert RawData and cert dates

## PROBLEM
When uploading a certificate to an app registration via `Update-MgApplication`, there are three common encoding/parameter mistakes that produce cryptic errors: double-encoding the key, using calculated UTC dates instead of the cert's own dates, and using the wrong parameter format (`-BodyParameter` with camelCase vs `-KeyCredentials` with PascalCase).

## WRONG
```powershell
# BAD -- double-encoded key, wrong date source, wrong parameter style
$base64Key = [System.Convert]::ToBase64String($cert.RawData)
$params = @{
    keyCredentials = @(@{          # camelCase -- wrong
        key           = [System.Text.Encoding]::ASCII.GetBytes($base64Key)  # double-encoded
        startDateTime = [DateTime]::UtcNow.ToString("o")  # wrong -- use cert's own dates
        endDateTime   = [DateTime]::UtcNow.AddYears(2).ToString("o")
    })
}
Update-MgApplication -ApplicationId $id -BodyParameter $params
```

## RIGHT
```powershell
# GOOD -- proven working pattern
$keyCredential = @{
    Type          = "AsymmetricX509Cert"
    Usage         = "Verify"
    Key           = $cert.RawData            # raw bytes, not base64
    DisplayName   = "AppName-$(Get-Date -Format 'yyyy-MM')"
    StartDateTime = $cert.NotBefore          # cert's own validity start
    EndDateTime   = $cert.NotAfter           # cert's own validity end
}
Update-MgApplication -ApplicationId $id -KeyCredentials @($keyCredential)
```

## NOTES
- Use `$cert.RawData` directly -- Graph accepts raw DER-encoded bytes
- Use `$cert.NotBefore` and `$cert.NotAfter` -- Graph handles timezone conversion internally. Do NOT pre-calculate these with `[DateTime]::UtcNow`.
- Use `-KeyCredentials` with PascalCase property names -- NOT `-BodyParameter` with camelCase
- Create the cert itself with `[DateTime]::Now` not `[DateTime]::UtcNow` -- the cert's `NotBefore`/`NotAfter` are already correct local dates that Graph will accept
