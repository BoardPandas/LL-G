---
tech: wix
tags: [windows-installer, productversion, versioning, release, upgrade, wix]
severity: high
---
# MSI ProductVersion limits differ from four-part executable versions

## PROBLEM
Windows EXE version resources accept four 16-bit fields. Windows Installer ProductVersion uses only three fields, with limits 255.255.65535; a fourth field does not participate in upgrade ordering. A release pipeline that copies the application version directly into WiX can work for hundreds of releases and fail when the minor version reaches 256. Clamping or wrapping the minor creates collisions or silently reverses upgrade ordering.

SupportForge's signed candidates had reached 3.270 without building the managed MSI. Reviewing the normal MSI pipeline caught the invalid product version before tagging. A signed EXE candidate was not evidence that the full installer could build.

## WRONG
```powershell
# Valid as an EXE resource version, outside MSI's minor range.
$WixVersion = '3.270.0.1'
# Clamping alone collapses all future minor releases.
$MsiMinor = [Math]::Min($AppMinor, 255)
```

## RIGHT
Keep application and installer identities explicit. Define a deterministic, bounded mapping that preserves the ordering of previously published MSI versions. Reject inputs outside its supported range rather than wrapping them. Test the old stable version, rollover, patch increments, upper bounds, and the next application major.

One mapping for an existing 3.251 fleet reserves MSI minor 255, then packs excess application minor and patch into the 16-bit MSI build field:
```text
source minor < 255: preserve the existing version
source minor 255..510, patch 0..255:
  MSI minor = 255
  MSI build = (source minor - 255) * 256 + source patch
3.251.1.1 -> 3.251.1.1
3.270.0.1 -> 3.255.3840.1
3.270.1.0 -> 3.255.3841.0
4.0.0.0   -> 4.0.0.0
```
Preserve the full source version in signed executable resources and application-owned version registry values. Document that Windows Apps can display the mapped package version. This is a bounded example, not an unlimited encoding of four 16-bit fields into three MSI fields.

## NOTES
- The fourth source field remains ignored for MSI upgrade ordering. If same-version upgrades are enabled, define and test the intended policy separately; do not claim it prevents downgrades differing only in that field.
- Preserve existing upgrade codes, component identities and runtime-data protection when correcting version conversion.
- A pure conversion test is not native installation acceptance. Run the normal WiX build and verify actual upgraded binaries and application identity.
- Source: https://learn.microsoft.com/en-us/windows/win32/msi/productversion
