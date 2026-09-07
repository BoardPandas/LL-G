---
tech: bash
tags: [macos, installer, applescript, finder, aliases, idempotency]
severity: high
---
# Finder's default alias name breaks installer cleanup keyed on a fixed name

## PROBLEM

A macOS PKG postinstall deleted only `Desktop/Get IT Support`, then asked Finder
to make an alias without specifying its name. Finder can use an `alias` suffix
or include the app extension. Those names survive the next install's exact-name
cleanup, so automatic updates leave duplicate desktop icons despite succeeding.
An existence guard must use the same naming contract as creation.

## WRONG

```bash
rm -f "$desktop/Get IT Support"
osascript -e 'tell application "Finder" to make alias file to POSIX file "/Applications/Get IT Support.app" at desktop'
```

## RIGHT

Give new aliases an explicit name:

```applescript
make alias file to supportApp at desktopFolder with properties {name:"Get IT Support"}
```

Before creating one, inspect existing installer-named aliases and compare their
resolved `original item` with the installed app. Keep a matching alias, preferably
the canonical name, and remove only verified redundant aliases. Normalize an old
default name when the canonical name is free. Preserve unrelated files and aliases
to other targets, even if their names match. Report a canonical-name conflict
instead of replacing a user's file or asking Finder to choose another name.

Pass paths through `osascript -` arguments and a quoted heredoc, not interpolated
AppleScript source. Do not swallow all diagnostics from shortcut maintenance.

## NOTES

Found in SupportForge's macOS agent postinstall after a screenshot showed both
`Get IT Support` and `Get IT Support alias`. This is an installer naming-contract
defect, not an updater download failure.

Test first install, several repeated runs, legacy suffix and extension names,
duplicate cleanup, and same-named unrelated files using real Finder aliases in
temporary folders. Check inode identity to prove reuse rather than replacement.
AppleScript compilation verifies syntax only; Finder AppleEvent timeouts mean the
native behavior test is unverified, not passing.
