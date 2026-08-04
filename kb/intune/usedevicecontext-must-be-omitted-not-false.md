---
tech: intune
tags: [intune, graph-api, windowsmobilemsi, lob-app, msi, usedevicecontext, powershell]
severity: high
---
# useDeviceContext must be OMITTED, not set to false, for a per-System-only MSI

## PROBLEM

Creating a `#microsoft.graph.windowsMobileMSI` app for a per-machine MSI and setting
`useDeviceContext = $true` fails at the content-file POST:

```
'UseDeviceContext' has been set on application, but MSI is not a dual-mode application.
It is a per-System MSI.
```

The message reads like a value problem, so the obvious fix is to flip it to `$false`. That
fails with the **byte-for-byte identical error**.

Intune counts the property as "set" merely by being **present in the payload**, regardless
of its value. `useDeviceContext: false` and `useDeviceContext: true` are equally invalid
for an MSI that only supports per-System installation. The property is only legal for
dual-mode MSIs (ones that can install per-user or per-machine). The only way to satisfy the
service is to leave the key out of the create body entirely, at which point Graph reports
it back as `null`.

This costs an extra debugging cycle precisely because `$false` looks like the corrective
action, and because PowerShell hashtable literals make it natural to keep a key and change
its value rather than delete the line. The error also arrives at
`POST .../contentVersions/{v}/files`, well after `POST /mobileApps` succeeded, so every
attempt strands another partial app.

## WRONG

```powershell
$appBody = [ordered]@{
    '@odata.type'          = '#microsoft.graph.windowsMobileMSI'
    displayName            = 'Cloudflare One Client'
    fileName               = $msiFile.Name
    commandLine            = '/qn ORGANIZATION="contoso"'
    productCode            = $productCode
    productVersion         = $productVersion
    ignoreVersionDetection = $true
    useDeviceContext       = $true     # 400: MSI is not a dual-mode application
}

# ...and the "obvious" fix fails identically:
    useDeviceContext       = $false    # 400: IDENTICAL error. Presence is what counts.
```

## RIGHT

```powershell
$appBody = [ordered]@{
    '@odata.type'          = '#microsoft.graph.windowsMobileMSI'
    displayName            = 'Cloudflare One Client'
    fileName               = $msiFile.Name
    commandLine            = '/qn ORGANIZATION="contoso"'
    productCode            = $productCode
    productVersion         = $productVersion
    ignoreVersionDetection = $true
    # No useDeviceContext key at all. Machine-context install is declared by the
    # content-file manifest instead:
    #   MsiExecutionContext="System" MsiIsMachineInstall="true"
}
```

Verify after creation. Graph returns the property as `null`, which is the state you want:

```powershell
(Invoke-MgGraphRequest -Method GET `
    -Uri "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$appId").useDeviceContext
# -> null
```

## NOTES

Machine versus user context for an MSI LOB app is carried by the base64 `MobileMsiData`
manifest on the content file, not by the app object. See
[windowsMobileMSI content files require a base64 MobileMsiData manifest](windowsmobilemsi-content-file-requires-manifest.md).
The two gotchas fire back to back: fixing the manifest gets you to this error.

Determine whether an MSI is per-System, per-User, or dual-mode from its `ALLUSERS`
property before deciding whether `useDeviceContext` is legal at all. `ALLUSERS=1` is
per-machine only, and for those the property must never appear.

The same "presence equals set" behaviour is worth assuming for other conditionally-valid
properties on the AppLifecycle service. When an error says a property "has been set" and
the value is already benign, try removing the key before assuming the message is wrong.

Reference implementation: `scripts/m365/Deploy-CloudflareOne-Intune.ps1` in
`Support-Forge/tech-assistant` (commit `36d2ec6`).
