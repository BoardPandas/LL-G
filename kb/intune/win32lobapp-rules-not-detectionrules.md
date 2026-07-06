---
tech: intune
tags: [intune, graph-api, win32lobapp, mobileApps, detectionRules, rules, detection-rule, app-deployment]
severity: high
---
# win32LobApp create needs the unified `rules` collection, not the legacy `detectionRules`

## PROBLEM
The current Intune app-metadata service (the AppLifecycle backend, seen as `api-version=2025-07-02`) has dropped the old `detectionRules` array and the `#microsoft.graph.win32LobApp*Detection` types. If you POST a `win32LobApp` with `detectionRules`, the property is **silently ignored** and the create fails with a misleading 400:

```
The Win32LobApp must have at least one detection rule specified.
```

The JSON is well-formed and the detection object looks valid, so you burn time chasing `@odata.type` ordering, single-element-array collapse in `ConvertTo-Json`, and rule-type spelling -- none of which is the cause. Detection rules now live in a unified `rules` collection where every rule is a `win32LobApp*Rule` subtype carrying a `ruleType` discriminator (`detection` or `requirement`). The same applies to requirement rules.

Two adjacent traps in the same body:
- `minimumSupportedOperatingSystem` (the `windowsMinimumOperatingSystem` object) is replaced by the string `minimumSupportedWindowsRelease` (e.g. `'1809'`).
- `displayVersion` silently drops on both create and PATCH via this service (cosmetic; leave it blank or set it in the portal).

Diagnosis trick: `GET` any existing, working `win32LobApp` in the tenant and inspect its `rules` property. GET normalizes to the current schema regardless of how the app was originally created, so a working app is a live schema reference.

## WRONG
```powershell
# 400 "The Win32LobApp must have at least one detection rule specified."
$appBody = [ordered]@{
    '@odata.type'                   = '#microsoft.graph.win32LobApp'
    displayName                     = 'Logitech Unifying Software'
    # ... fileName, setupFilePath, install/uninstall command lines ...
    minimumSupportedOperatingSystem = [ordered]@{ '@odata.type' = '#microsoft.graph.windowsMinimumOperatingSystem'; v10_1809 = $true }
    detectionRules                  = @(
        [ordered]@{
            '@odata.type'         = '#microsoft.graph.win32LobAppPowerShellScriptDetection'  # ignored
            enforceSignatureCheck = $false
            runAs32Bit            = $false
            scriptContent         = $detectB64
        }
    )
}
Invoke-MgGraphRequest -Method POST -Uri "$base/deviceAppManagement/mobileApps" -Body ($appBody | ConvertTo-Json -Depth 12) -ContentType 'application/json'
```

## RIGHT
```powershell
# Unified `rules` collection: *Rule subtype + ruleType discriminator.
$psRule = [ordered]@{
    '@odata.type'         = '#microsoft.graph.win32LobAppPowerShellScriptRule'
    ruleType              = 'detection'
    displayName           = $null
    enforceSignatureCheck = $false
    runAs32Bit            = $false
    scriptContent         = $detectB64           # base64 of the detection .ps1
    operationType         = 'notConfigured'      # exit-code/STDOUT detection
    operator              = 'notConfigured'
    comparisonValue       = $null
}
$appBody = [ordered]@{
    '@odata.type'                  = '#microsoft.graph.win32LobApp'
    displayName                    = 'Logitech Unifying Software'
    # ... fileName, setupFilePath, install/uninstall command lines, applicableArchitectures ...
    minimumSupportedWindowsRelease = '1809'       # string, NOT the min-OS object
    installExperience              = [ordered]@{ '@odata.type' = '#microsoft.graph.win32LobAppInstallExperience'; runAsAccount = 'system'; deviceRestartBehavior = 'suppress' }
    rules                          = @($psRule)
}
Invoke-MgGraphRequest -Method POST -Uri "$base/deviceAppManagement/mobileApps" -Body ($appBody | ConvertTo-Json -Depth 12) -ContentType 'application/json'
```

## NOTES
- Rule subtypes: `win32LobAppFileSystemRule`, `win32LobAppRegistryRule`, `win32LobAppProductCodeRule`, `win32LobAppPowerShellScriptRule`. Each takes `ruleType='detection'` or `ruleType='requirement'`.
- Everything else in the Win32 LOB upload flow is unchanged: create app -> contentVersions -> files -> Azure SAS block-blob upload -> commit with fileEncryptionInfo -> PATCH committedContentVersion -> poll `publishingState=published` (see [mobileapp-assignment-requires-published-state]) -> assign. Cert app-only Graph with `DeviceManagementApps.ReadWrite.All` does all of it (see [autodesk-odis-win32-deploy]).
- Related: `ConvertTo-Json` does NOT collapse single-element nested arrays in current PowerShell 7, so that is a red herring here -- the array is fine; the property name is the problem.
