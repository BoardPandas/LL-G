---
tech: wix
tags: [wix, msi, windows-installer, major-upgrade, removeexistingproducts, config, data-loss]
severity: high
---
# Major upgrade wipes runtime-modified data files (config.json) despite NeverOverwrite

## PROBLEM
A WiX `<MajorUpgrade>` defaults `RemoveExistingProducts` to an early schedule. When scheduled `afterInstallInitialize`, Windows Installer fully UNINSTALLS the old product BEFORE the new product lays down its files. Any file the running app modified at runtime (e.g. `C:\ProgramData\<App>\config.json` holding enrolled identity / license / tokens) is owned by the old product's component, so the early removal DELETES it. The new install then drops its pristine template. `NeverOverwrite="yes"` does NOT protect the file: it only prevents overwriting a file that still exists at install time, but the early uninstall already deleted it.

Real-world impact: a desktop fleet agent updated via MSI lost its `clientId`/`agentId` from config.json. Every heartbeat then failed `400 {"error":"agentId is required"}` and the command websocket failed token fetch with `400`. The device kept running and even showed the new version in its About dialog (read from the baked-in binary), but never reported to the server again. Pinning the build to the whole fleet would have orphaned every device on update. Silent and fleet-wiping -> HIGH.

## WRONG
```xml
<!-- Old product is uninstalled FIRST (afterInstallInitialize / afterInstallValidate),
     deleting the runtime-enriched config.json before the new files install.
     NeverOverwrite cannot save a file that has already been deleted. -->
<MajorUpgrade Schedule="afterInstallInitialize"
              DowngradeErrorMessage="..." />

<Component Id="ConfigFile" Guid="*" NeverOverwrite="yes">
  <File Source="$(var.DistDir)\config.json" Name="config.json" KeyPath="yes" />
</Component>
```

## RIGHT
```xml
<!-- Schedule removal LATE so the new product's shared component (same stable
     auto-GUID, derived from the install path) is registered BEFORE the old product
     is removed. Reference counting then keeps the file instead of deleting it. -->
<MajorUpgrade Schedule="afterInstallExecute"
              DowngradeErrorMessage="..." />

<!-- Permanent="yes" hard-guards the user-data file: it is never removed, even by a
     full uninstall or the old product's removal. NeverOverwrite still lets a fresh
     install drop the template once, then never clobber the runtime-enriched file. -->
<Component Id="ConfigFile" Guid="*" Permanent="yes" NeverOverwrite="yes">
  <File Source="$(var.DistDir)\config.json" Name="config.json" KeyPath="yes" />
</Component>
```

## NOTES
- The corrected scheduling lives in the NEW installer, and it controls the upgrade sequence, so devices on the old (buggy) build are protected once they take the fixed build. Devices already orphaned by a buggy build need manual recovery (rewrite config + restart the service).
- Component GUIDs must be stable across versions for the shared-component reference counting to work. WiX `Guid="*"` auto-derives a stable GUID from the component's install location + keypath, so a file installed to the same path in both versions shares the GUID. Hard-coded differing GUIDs break this.
- Defense in depth: have the app also mirror its identity to a store the installer never owns (e.g. an HKLM registry value the MSI does not declare as a removable component) and fall back to it when config is missing, so a device can self-heal even if a future installer wipes config again.
- macOS PKG equivalent: guard the postinstall config write with `if [[ ! -f "$CONFIG_FILE" ]]` so upgrades preserve existing config.
