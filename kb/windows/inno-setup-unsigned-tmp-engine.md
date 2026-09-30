---
tech: windows
tags: [inno-setup, code-signing, authenticode, smart-app-control, signtool, artifact-signing, installer, ci]
severity: high
---
# Signing an Inno Setup setup.exe after compilation leaves the extracted .tmp engine unsigned

## PROBLEM
An Inno Setup `setup.exe` is only a loader. When it runs, it extracts the real setup engine to `%TEMP%\is-XXXXX.tmp\<name>.tmp` and runs that. If you sign the finished `setup.exe` after ISCC builds it (signtool post-build, `Azure/artifact-signing-action`, etc.), the signature covers the loader only. The engine is embedded before signing, so it stays unsigned.

Smart App Control (and Defender ASR rules) then block the engine: "Part of this app has been blocked ... we can't confirm who published `<name>.tmp` that the app tried to load." Every install and every in-app update fails.

It is silent in CI. `Get-AuthenticodeSignature setup.exe` reports `Valid` with a timestamp, so a signature gate passes and a signed release goes out that won't install on SAC-enabled machines.

## WRONG
```powershell
& ISCC.exe installer\app.iss
# then sign the output
signtool sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 ... installer\Output\setup.exe
Get-AuthenticodeSignature installer\Output\setup.exe   # Valid -- but the engine inside is not
```

## RIGHT
```ini
; app.iss -- only when CI passes /DSign, so local builds need no signing setup
#ifdef Sign
SignTool=app
SignedUninstaller=yes
#endif
```
```powershell
# ISCC signs the engine before embedding it, plus the uninstaller and setup.exe.
# Build the command with single quotes so PowerShell leaves Inno's $q/$f alone.
$sign = '$q' + $signtool + '$q sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256' +
        ' /dlib $q' + $dlib + '$q /dmdf $q' + $metadataJson + '$q $f'   # Artifact Signing dlib
& ISCC.exe /DSign "/Sapp=$sign" installer\app.iss
```

## NOTES
- Verify the engine itself, not setup.exe. Run the installer with `/VERYSILENT /DIR=...`. While it runs, copy the engine from `Get-Process | ? Path -like '*\is-*.tmp\*.tmp'`; copying the running process's image guarantees the loader has finished writing it. Give the copy a `.exe` name, then check it and `unins000.exe` with `Get-AuthenticodeSignature`, including that the signer subject matches setup.exe's.
- The Inno maintainer confirms that SignTool signs the .tmp and that signing after compilation cannot: https://groups.google.com/g/innosetup/c/7RpEFVoaHZI
- For Artifact Signing, the signtool + dlib + `metadata.json` setup (fields: `Endpoint`, `CodeSigningAccountName`, `CertificateProfileName`) is documented at https://learn.microsoft.com/azure/artifact-signing/how-to-signing-integrations. The dlib authenticates with DefaultAzureCredential, so pass `AZURE_CLIENT_ID/TENANT_ID/CLIENT_SECRET` in the ISCC step's env.
- Hit in Hark 0.60.5 on 2026-09-30; the fix shipped in 0.60.7.
