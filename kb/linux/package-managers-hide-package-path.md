---
tech: linux
tags: [dpkg, rpm, pacman, maintainer-scripts, installer, filename-token, msi, pkg]
severity: high
---
# Package managers never tell install scripts which file they came from

## PROBLEM
Carrying a token (e.g. an enrollment code) in an installer's filename works on macOS and Windows but cannot work for .deb/.rpm/.pkg.tar.zst: dpkg calls postinst with `configure <version>`, rpm and pacman scriptlets get counts/versions, and none receive the package path. Guessing it from the parent process breaks under apt, GNOME Software and other frontends. By contrast macOS Installer passes the package path as `$1` to preinstall/postinstall, and Windows Installer exposes it as the `OriginalDatabase` property.

## WRONG
```sh
# postinst -- $1 is "configure", not a path
TOKEN=$(basename "$1" | grep -o 'sfi_[A-Za-z0-9]\{20\}')
```

## RIGHT
```sh
# Linux: carry the token in a generated one-line installer that writes it before installing
curl -fsSL 'https://api.example/install/<code>/linux.sh' | sudo sh
```
```bash
# macOS postinstall: $1 is the .pkg path (bash 3.2: keep the regex in a variable)
RE='(^|[^A-Za-z0-9])(sfi_[A-Za-z0-9]{20})([^A-Za-z0-9]|$)'
[[ "$(basename "$1")" =~ $RE ]] && CODE="${BASH_REMATCH[2]}"
```
```xml
<!-- WiX: no custom action needed; >< is the substring operator -->
<Component Id="InstallerPathHint" Condition="OriginalDatabase &gt;&lt; &quot;sfi_&quot;">
  <RegistryValue Root="HKLM" Key="SOFTWARE\Vendor" Name="InstallerPath" Value="[OriginalDatabase]" Type="string" KeyPath="yes" />
</Component>
```

## NOTES
A PKG run from a mounted DMG gets a `/Volumes/...` path; map it back to the .dmg with `hdiutil info`. Parse with bounded regexes so a browser " (1)" suffix still matches. Treat any filename token as public (install logs, Downloads, Windows SourceList registry) -- scope it to the least privilege.
