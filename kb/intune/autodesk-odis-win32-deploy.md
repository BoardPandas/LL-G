---
tech: intune
tags: [intune, autodesk, autocad, win32, win32lobapp, graph-api, odis, sas-upload, packaging]
severity: high
---
# Autodesk (ODIS) Win32 deploy: package the generated image, not the downloaded creator exe

## PROBLEM
The single .exe you download from the Autodesk Account "Custom Install / Create Deployment" flow (e.g. "Autodesk AutoCAD Electrical 2027.exe", ~30 MB) is NOT the installer. Its metadata gives it away: `OriginalFilename = AdOdisDeployTool.exe`, `ProductName = Autodesk Create Installer`. It is the ODIS deployment *creator*. You must RUN it first (sign in to Autodesk, pick the product, choose a path) to download the multi-GB payload and generate the real deployment-image folder. That folder is what you wrap with IntuneWinAppUtil.

Wrapping the 30 MB creator into a .intunewin produces a package that cannot silently install: it has no `image\Installer.exe`, no `Collection.xml`, and would try to launch an interactive downloader on the endpoint. It "uploads fine" and then fails on every device, which is expensive to debug after the fact.

Second trap: many guides claim the Graph Win32 LOB upload needs delegated/interactive auth. It does not. A certificate app-only token works end to end, because the large content upload goes to the Azure Blob SAS URI that Graph hands you (the SAS is the auth), not to a Graph endpoint.

## WRONG
```powershell
# WRONG 1: wrapping the 30 MB downloaded exe directly
IntuneWinAppUtil.exe -c "C:\Downloads" -s "Autodesk AutoCAD Electrical 2027.exe" -o "C:\out"
# install command guess:
"Autodesk AutoCAD Electrical 2027.exe" /quiet   # no such silent switch; it's a GUI downloader

# WRONG 2: assuming you must abandon cert auth for the upload
Connect-MSIntuneGraph -Interactive   # not required; cert app-only is fine
```

## RIGHT
```powershell
# 1) RUN the creator first -> it builds the image folder:
#    <root>\Install <Product>.bat            (has --installer_version)
#    <root>\image\Installer.exe              (the -s setup file)
#    <root>\image\Collection.xml             (referenced by -o)
#    <root>\image\<BUNDLE>\setup.xml         (uninstall manifest)

# 2) Package the IMAGE FOLDER (paths are relative to the package root):
IntuneWinAppUtil.exe -c "C:\AutodeskDeploy\acad" -s "image\Installer.exe" -o "C:\out" -q

# 3) Win32 app commands (silent variant comes straight from the .bat):
#    install:   image\Installer.exe -i deploy --offline_mode -q -o "image\Collection.xml" --installer_version "2.21.0.646"
#    uninstall: image\Installer.exe -i uninstall -q --manifest "image\<BUNDLE>\setup.xml"
#    detection: MSI product code of the "<Product> - English" entry from Summary.txt
#    context: System, x64, min OS 1809, maxRunTimeInMinutes ~120 (install is long)

# 4) Upload over Graph with a CERT app-only token (no interactive sign-in):
Connect-MgGraph -ClientId $appId -TenantId $tid -CertificateThumbprint $thumb -NoWelcome
# Graph metadata calls via Invoke-MgGraphRequest; the encrypted IntunePackage.intunewin
# (inside the .intunewin zip at IntuneWinPackage\Contents\) is PUT to the Azure Blob SAS
# URI returned by Graph in 6 MB blocks (x-ms-blob-type via comp=block, then comp=blocklist),
# renewUpload to refresh the SAS on long transfers, then POST .../files/{id}/commit with the
# fileEncryptionInfo parsed from IntuneWinPackage\Metadata\Detection.xml.
```

## NOTES
- App-registration permission required: `DeviceManagementApps.ReadWrite.All`. `DeviceManagementConfiguration.ReadWrite.All` and `DeviceManagementManagedDevices.ReadWrite.All` do NOT cover `/deviceAppManagement/mobileApps` (you get 403).
- AutoCAD 2025+ (incl. 2027) is named-user licensing only: serial numbers are gone, so older guides' "Serial Number" deployment step does not apply. Intune installs the bits; it does not license. Users still sign in with an Autodesk ID that has a seat assigned.
- The .intunewin inner encrypted file is ~48 bytes larger than `UnencryptedContentSize` (AES header) -- that's normal; send `size` = unencrypted and `sizeEncrypted` = the inner file length.
- "Available" assignment cannot target All Devices (device-only); "Available to all" means the built-in All Users group = `allLicensedUsersAssignmentTarget`.
- Generated `Collection.xml` contains absolute paths from the build machine, but `Installer.exe` locates the image relative to itself, so the package still works after Intune extracts it to IMECache.
- Build the image to a local, non-OneDrive path: a 6-7 GB image under OneDrive will sync to the cloud and can leave online-only placeholders that package as empty files.
