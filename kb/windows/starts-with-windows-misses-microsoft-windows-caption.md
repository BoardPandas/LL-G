---
tech: windows
tags: [platform-detection, wmi, caption, os-name, string-matching, feature-gating]
severity: high
---
# A "starts with windows" platform check misses "Microsoft Windows 11 Pro"

## PROBLEM
The operating-system name an agent or inventory tool reports for Windows is usually the WMI caption (`Win32_OperatingSystem.Caption`), which begins with the vendor: "Microsoft Windows 11 Pro", "Microsoft Windows Server 2025 Standard". Other sources report "Windows 11 Pro", "Windows", "win32" or "windows". One fleet contains all of them at once, depending on agent version and collection path.

A check written as "starts with windows" passes every fixture typed by hand and fails on the caption form. The device is then treated as non-Windows: Windows-only tools disappear, actions read "Windows devices only", and an update view says the platform is unknown. Nothing errors, and only some devices are affected, so it reads as a data problem.

## WRONG
```ts
export const isWindows = (platform: string) => /^(windows|win32|win64)/i.test(platform.trim())

isWindows('Windows 11 Pro')                         // true
isWindows('Microsoft Windows Server 2025 Standard') // false
```

## RIGHT
```ts
// One shared helper; match the word anywhere.
export const isWindows = (platform: string) => /\bwindows\b|^win(32|64)\b/i.test(platform)
export const isMacOS = (platform: string) => /\bmac\s?os\b|\bos x\b|\bdarwin\b/i.test(platform)
```

## NOTES
- Use word boundaries for every platform. A bare `mac` substring also matches a Linux string containing "machine".
- Keep one helper and use it everywhere a screen or an action is gated by platform. Two copies drift, and the stricter one silently hides features.
- Prefer a normalised family field (`os_family: 'windows' | 'macos' | 'linux'`) computed once on the server over matching display text in the client.
- Put the caption form in the test fixtures. Hand-typed fixtures are how this passed review.
