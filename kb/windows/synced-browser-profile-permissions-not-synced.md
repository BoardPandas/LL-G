---
tech: windows
tags: [edge, chrome, chromium, sync, notifications, site-permissions, forensics, false-negative, laptop-swap, scareware]
severity: high
---
# A replacement PC's synced browser profile carries history but NOT site permissions

## PROBLEM
User reports recurring browser scareware ("your McAfee expired") and by the time you get on the box they are on a **different machine** — a replacement laptop, a reimage, or a second device. You check the machine they are using now, find a full browsing history going back weeks, and also find **zero notification grants**. The obvious read is "I have their whole browsing profile here, and there are no grants, so there was never a push-notification grant anywhere."

That conclusion is wrong, and the synced history is what makes it seductive.

Chromium sync (Edge and Chrome) **does** sync `typed_urls`/history, bookmarks, passwords, extensions and the `preferences` datatype. It does **not** sync `content_settings` exceptions — notification permissions are deliberately excluded as device-scoped. So on a brand-new profile you get:

- weeks of history that was actually browsed on the *old* device (great — use it), and
- an empty notifications exception list that describes **only the new device** (useless as evidence about the old one).

Real case: a 3-hour-old Edge profile held 12,793 visits dating back four weeks, yet had 0 notification grants. The scareware grant, if any, was still sitting on the powered-off previous laptop.

## WRONG
```powershell
# On the replacement machine
$o = ParsePrefs $newMachinePrefs
$o['profile']['content_settings']['exceptions']['notifications'].Keys.Count   # -> 0
(Get-VisitCount $newMachineHistory)                                          # -> 12793 visits, 4 weeks

# "History synced, so this profile is complete. Zero grants => no push scareware. Case closed."
# The old laptop still has the grant and will keep firing when it is next powered on,
# or will be handed to the next employee with the grant intact.
```

## RIGHT
```powershell
# 1. Confirm what actually synced, on-box, instead of assuming.
$sync = $o['sync']
"keep_everything_synced = $($sync['keep_everything_synced'])"   # True
"typed_urls             = $($sync['typed_urls'])"               # True  -> history IS shared
"preferences            = $($sync['preferences'])"              # True  -> but see below

# 2. The decisive check: which exception TYPES are non-empty on the fresh profile?
$ex = $o['profile']['content_settings']['exceptions']
foreach ($k in @($ex.Keys)) { $c = $ex[$k].Keys.Count; if ($c) { "$k=$c" } }
# Real output on a synced-but-fresh profile:
#   app_banner, client_hints, cookie_controls_metadata, media_engagement,
#   site_engagement, trackers_data, tracking_org_relationships
# ALL locally-generated telemetry. No permission types (notifications/geolocation/camera).
# => permissions did not travel. Zero grants here is NOT evidence about the other device.

# 3. Mine the synced history for the incident (this part IS trustworthy and cross-device),
#    then state plainly that the permission check is still OUTSTANDING on the original box.
```

## NOTES
- **Split your conclusion by datatype.** Synced history is valid evidence about *the user's browsing on any device*. Site permissions, Windows toast-sender AUMIDs (`HKU\<SID>\...\Notifications\Settings`), and the toast database (`wpndatabase.db`) are all **per-device** and say nothing about another machine. Report the second group as OUTSTANDING, never as CLEAN.
- The same asymmetry bites on reimages and on "we already swapped their laptop" tickets. Ask *which* machine the symptom was on before scoping the work — the Windows profile directory creation time (`(Get-Item C:\Users\<user>).CreationTimeUtc`) tells you instantly whether the user had ever logged into the box you are standing on.
- A newly-provisioned machine can look reassuringly clean for a boring reason. Check whether a browser was ever *launched* before crediting a zero: Chrome installed but never run leaves `...\Chrome\User Data` containing only a `Crashpad` folder and **no** `Preferences` file, so "0 Chrome grants" is trivially true and proves nothing.
- Synced history is a genuine gift for this class of incident: it lets you reconstruct a malvertising chain that happened weeks earlier on hardware you cannot reach. Pull real timestamps from the `visits` table rather than regexing the file — see `kb/powershell/locked-file-read-false-clean.md` for reading the locked DB and using `winsqlite3.dll` when `sqlite3.exe` is absent.
- Related: [Fake-antivirus toasts "via Microsoft Edge" are web push](edge-push-notification-scareware-cleanup.md).
