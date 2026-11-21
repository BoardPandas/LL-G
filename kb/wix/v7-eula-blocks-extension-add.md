---
tech: wix
tags: [wix, wix7, osmf, eula, wix7015, extension, dotnet-tool, ci, powershell, exit-code]
severity: high
---
# WiX v7 EULA check also blocks wix extension add

## PROBLEM
WiX Toolset v7 enforces its Open Source Maintenance Fee (OSMF) EULA at the CLI.
Until the EULA is accepted, **every** `wix` command fails with
`error WIX7015: You must accept the Open Source Maintenance Fee (OSMF) EULA to use WiX Toolset v7`,
and that includes `wix extension add`, not only `wix build`.

Upgrade notes and most examples show `-acceptEula wix7` on `wix build`
alone. A build script that adds extensions the common v4/v5 way, with stderr
discarded and no exit-code check, swallows the refusal. The build then fails
at the next step with an extension-not-found error that points nowhere near
the real cause. On a CI runner the failure is guaranteed: `wix eula accept wix7`
writes per-user, per-machine acceptance state, and a fresh runner never has it.

A second trap: WiX extensions must be the same version as the CLI. A version
hard-coded separately in the workflow and the build script drifts on the next
upgrade.

## WRONG
```powershell
dotnet tool install --global wix --version 7.0.1
& wix extension add WixToolset.Util.wixext/5.0.2 2>$null   # WIX7015 + stale version, both hidden
& wix build -acceptEula wix7 -ext WixToolset.Util.wixext -o out.msi product.wxs
# -> fails later: the extension was never added
```

## RIGHT
```powershell
# One pin file read by CI and the build script.
$WixToolVersion = (Get-Content -LiteralPath wix-version.txt -Raw).Trim()
$installed = (& wix --version | Out-String).Trim()          # prints 7.0.1+<commit>; needs no EULA
if ($installed -ne $WixToolVersion -and -not $installed.StartsWith("$WixToolVersion+")) {
    throw "WiX $installed installed, build pinned to $WixToolVersion"
}
foreach ($ext in 'WixToolset.Util.wixext', 'WixToolset.UI.wixext') {
    & wix extension add "$ext/$WixToolVersion" -acceptEula wix7   # idempotent when cached
    if ($LASTEXITCODE -ne 0) { throw "wix extension add $ext failed ($LASTEXITCODE)" }
}
& wix build -acceptEula wix7 -arch x64 -ext WixToolset.Util.wixext -o out.msi product.wxs
if ($LASTEXITCODE -ne 0) { throw "wix build failed ($LASTEXITCODE)" }
```

## NOTES
- `-acceptEula wix7` and `--acceptEula wix7` both work, in any position after the
  subcommand. Per `wix --help`, the flag accepts the EULA "for this invocation without
  creating an acceptance file", so a developer machine and a fresh runner behave alike.
- Accepting is a licensing decision. Pass the flag only when the organisation meets the
  OSMF terms (for example by sponsoring the WiX project), and record that basis where the
  build is documented.
- Verified 2026-11-21 with the `wix` 7.0.1 dotnet tool (`7.0.1+642f1a0`). The same
  release still exports `WixQuietExec64` from `Wix4UtilCA_X86` and `Wix4UtilCA_X64`,
  even though the docs say it will be removed in the next major version.
- When moving a package from v5 to v7, diff the MSI tables of both builds. In the case
  that produced this entry, Component GUIDs were identical, which matters for packages
  that schedule `RemoveExistingProducts` late (see `major-upgrade-config-wipe.md`).
