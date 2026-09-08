---
tech: windows
tags: [winget, chocolatey, patch-management, arp, inventory, bootstrapper, version-pinning]
severity: high
---
# Package-manager identity is not installed Windows product identity

## PROBLEM

A package-manager version can differ from the version Windows records in Add/Remove Programs (ARP). Comparing installed inventory directly with the source version can reject a successful installation forever or repeatedly schedule it. The WinGet manifest for AgileBits.1Password 8.12.34.34 explicitly declares the machine MSI's ARP DisplayVersion as 8.12.34.

Likewise, a locale manifest's Publisher describes catalog metadata; it is not evidence that the same publisher string is registered by the installer. Broadening publisher/name matching until a test passes can accept another edition or a different product.

A pinned source version and SHA256 prove the outer artifact's identity, not which inner product a bootstrapper downloads. A checksum-verified bootstrapper that fetches "latest" can install a newer, unapproved product release.

## WRONG

```text
expectedInstalledVersion = source.PackageVersion
expectedARPPublisher = locale.Publisher
install(source.id, source.version, source.sha256)
verified = installed.version >= expectedInstalledVersion
// Bootstrapper checksum is treated as proof of the installed version pin.
```

## RIGHT

```text
approved = {
  source: { packageId, packageVersion, artifactDigest },
  installed: { productIdentity, arpVersion, publisher, architecture, scope, track }
}
require evidence that the selected installer pins approved.installed.arpVersion
require current same-row identity matches product, publisher, architecture and scope
require current and target versions remain within the approved servicing track
install only the approved source artifact
observe installed product again; verify against approved.installed, not source metadata
```

Keep source version and expected installed version separate and immutable in approval records. Derive mappings from the selected installer manifest's AppsAndFeaturesEntries, product codes, vendor documentation, and actual installed evidence. If a required mapping or deterministic inner payload cannot be established, mark the source unsupported rather than reporting automation readiness. An installed-version override fixes verification semantics; it cannot make a mutable bootstrapper deterministic.

## NOTES

- Primary example: [Microsoft WinGet repository, AgileBits.1Password 8.12.34.34 installer manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/a/AgileBits/1Password/8.12.34.34/AgileBits.1Password.installer.yaml), inspected 2026-09-08. PackageVersion is 8.12.34.34; the machine MSI AppsAndFeaturesEntries DisplayVersion is 8.12.34. Its MSIX alternatives are different deployment identities.
- A version comparator must run only after edition/channel/major track, architecture and scope match. A higher version in another product line is not completion evidence.
- Preserve raw observed display names. If a product includes its version in the display name, use a bounded registry-authored pattern, then normalize only the private detection view.
- This is separate from [WinGet under LocalSystem](winget-system-powershell-module.md): a supported execution context still does not prove the installed identity.
