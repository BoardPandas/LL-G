---
tech: powershell
tags: [json, convertfrom-json, case-sensitivity, duplicate-keys, chromium, edge, parsing, false-failure]
severity: high
---
# ConvertFrom-Json is case-INSENSITIVE and throws on valid JSON containing keys that differ only by case

## PROBLEM
JSON is case-sensitive: `{"LOL":1,"lol":2}` is a perfectly legal object with two distinct keys. PowerShell's `ConvertFrom-Json` deserializes into a case-**insensitive** dictionary, so those two keys collide and the whole parse throws:

    Cannot convert the JSON string because a dictionary that was converted from the string
    contains the duplicated keys 'LOL' and 'lol'.

The file is not corrupt. Nothing is wrong with it. `ConvertFrom-Json` simply cannot represent it. This affects **the entire document** -- one colliding pair anywhere blows up the whole parse, including the 99% you actually wanted.

Real trigger: Microsoft Edge's `Preferences` stores Edge Rewards coachmark state keyed by search term, and real users generate both `LOL`/`lol`, `MINECRAFT`/`minecraft`, `UNICEF`/`unicef`, `WIKIPEDIA`/`wikipedia`. A script that reads Edge Preferences works on most machines and then hard-fails on one, for reasons that look like corruption but are not.

## WRONG
```powershell
# Works on most machines. Throws on any profile whose owner searched both "lol" and "LOL".
$j = Get-Content $prefs -Raw | ConvertFrom-Json
$j.profile.content_settings.exceptions.notifications
# -> Cannot convert the JSON string because a dictionary ... duplicated keys 'LOL' and 'lol'.
```

## RIGHT
```powershell
# JavaScriptSerializer (Windows PowerShell 5.1, .NET Framework) uses a case-SENSITIVE
# Dictionary[string,object] and parses the file correctly.
Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength  = [int]::MaxValue    # default is ~2MB and will silently bite on big prefs files
$ser.RecursionLimit = 1000

$txt = [System.IO.File]::ReadAllText($prefs, [System.Text.Encoding]::UTF8)
$o   = $ser.DeserializeObject($txt)      # Dictionary[string,object], case-sensitive

$notif = $o['profile']['content_settings']['exceptions']['notifications']
foreach ($k in @($notif.Keys)) { "{0} setting={1}" -f $k, $notif[$k]['setting'] }
```

## NOTES
- **Do not conclude the file is corrupt.** The give-away is that the exception names the colliding keys. Read the raw bytes and confirm it is well-formed before you "repair" anything -- deleting or rewriting a healthy 1.2 MB browser profile is a far worse outcome than the parse error.
- PowerShell 7 has the same case-insensitive behaviour for `ConvertFrom-Json`. `-AsHashtable` in PS7 uses an ordered case-**sensitive** hashtable and does parse these files; there is no equivalent in 5.1.
- `System.Web.Extensions` is .NET Framework only -- it exists in `powershell.exe` (5.1) but not `pwsh` 7+. See [System.Web is .NET Framework only](system-web-not-in-pwsh7.md). Under PS7, use `ConvertFrom-Json -AsHashtable` instead.
- `JavaScriptSerializer.MaxJsonLength` defaults to about 2 MB and throws on larger input. Set it before deserializing anything user-generated.
- If you must round-trip and write back, note this class does not pair with `ConvertTo-Json` -- see [ConvertTo-Json truncates at -Depth 2](convertto-json-depth-truncation.md) for the write-side trap.
