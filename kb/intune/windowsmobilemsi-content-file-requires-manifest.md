---
tech: intune
tags: [intune, graph-api, windowsmobilemsi, lob-app, msi, mobileappcontentfile, manifest, powershell]
severity: high
---
# windowsMobileMSI content files require a base64 MobileMsiData manifest

## PROBLEM

Uploading a line-of-business MSI (`#microsoft.graph.windowsMobileMSI`) fails at the
content-file step with an HTTP 400 that names a property most Win32 upload code
deliberately sets to null:

```
{"error":{"code":"BadRequest","message":"{
  \"Message\": \"Invalid manifest: must not be null for the current app type. ...\"
}"}}
```

The trap is that `win32LobApp` content files legitimately pass `manifest: null`, and the
`.intunewin` metadata carries everything Intune needs. Every published Win32 upload
routine therefore hardcodes `manifest = $null`. Point that same routine at an MSI LOB app
and it 400s, because `windowsMobileMSI` **requires** a manifest describing how the MSI
installs.

The error is also misplaced. It surfaces on the POST to
`.../contentVersions/{v}/files`, not on app creation, so by the time you see it the
`mobileApp` already exists. Each failed attempt leaves an orphaned partial app that must
be deleted before retrying, or the next run trips a duplicate-name guard.

## WRONG

```powershell
# Copied from a working win32LobApp uploader. Fails for windowsMobileMSI.
$fileBody = [ordered]@{
    '@odata.type'  = '#microsoft.graph.mobileAppContentFile'
    name           = $msiFile.Name
    size           = $encrypted.PlainSize
    sizeEncrypted  = $encrypted.EncryptedSize
    manifest       = $null          # <-- valid for Win32, fatal for MSI LOB
    isDependency   = $false
}
Invoke-MgGraphRequest -Method POST `
    -Uri "$root/contentVersions/$($cv.id)/files" `
    -Body ($fileBody | ConvertTo-Json -Depth 10)
# 400 Invalid manifest: must not be null for the current app type.
```

## RIGHT

```powershell
# Read UpgradeCode straight out of the MSI Property table.
$installer = New-Object -ComObject WindowsInstaller.Installer
$database  = $installer.GetType().InvokeMember(
    'OpenDatabase', 'InvokeMethod', $null, $installer, @($MsiPath, 0))
$view = $database.GetType().InvokeMember(
    'OpenView', 'InvokeMethod', $null, $database,
    @("SELECT Value FROM Property WHERE Property = 'UpgradeCode'"))
$view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
$record      = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
$upgradeCode = $record.GetType().InvokeMember('StringData', 'GetProperty', $null, $record, 1)

# The manifest is base64-encoded MobileMsiData XML.
$manifestXml = ('<MobileMsiData MsiExecutionContext="System" MsiRequiresReboot="false" ' +
                'MsiUpgradeCode="{0}" MsiIsMachineInstall="true" MsiIsUserInstall="false" ' +
                'MsiIncludesServices="true" MsiContainsSystemRegistryKeys="false" ' +
                'MsiContainsSystemFolders="false"></MobileMsiData>') -f $upgradeCode

$fileBody = [ordered]@{
    '@odata.type'  = '#microsoft.graph.mobileAppContentFile'
    name           = $msiFile.Name
    size           = $encrypted.PlainSize
    sizeEncrypted  = $encrypted.EncryptedSize
    manifest       = [Convert]::ToBase64String(
                         [System.Text.Encoding]::UTF8.GetBytes($manifestXml))
    isDependency   = $false
}
```

## NOTES

`MsiExecutionContext` accepts `System`, `User`, or `Dual`. It must agree with what the MSI
actually supports, and it is how you declare a machine-context install for an MSI LOB app.
Do not try to declare that with `useDeviceContext` on the app instead: see
[useDeviceContext must be omitted, not set to false, for a per-System-only MSI](usedevicecontext-must-be-omitted-not-false.md),
which is the failure you hit immediately after fixing this one.

Wrap the retry loop so a failure deletes its partial app. Because the 400 lands after
`POST /mobileApps` has already succeeded, a naive retry accumulates orphans that are
invisible unless you list `mobileApps` and filter by publisher.

Confirmed working end to end under app-only certificate auth with
`DeviceManagementApps.ReadWrite.All`; no interactive sign-in is needed. Reference
implementation: `scripts/m365/Deploy-CloudflareOne-Intune.ps1` in
`Support-Forge/tech-assistant` (commit `36d2ec6`), which uploads the Cloudflare One client
MSI and assigns it Required to All Devices.

The rest of the MSI LOB flow matches Win32: create app, create content version, create the
file entry, poll for `azureStorageUri`, PUT the encrypted bytes to the SAS URI in 6 MB
blocks, commit with `fileEncryptionInfo`, PATCH `committedContentVersion`, then poll
`publishingState` before assigning (see
[Intune mobileApp assignment fails until publishingState is 'published'](mobileapp-assignment-requires-published-state.md)).
