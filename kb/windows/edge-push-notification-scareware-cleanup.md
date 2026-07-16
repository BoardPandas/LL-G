---
tech: windows
tags: [edge, chromium, web-push, notifications, scareware, fake-antivirus, wpndatabase, preferences, aumid, ntfs-tunneling, background-mode]
severity: high
---
# Fake-antivirus toasts "via Microsoft Edge" are web push, not malware -- and the cleanup has four traps

## PROBLEM
A user reports a virus: a McAfee/Norton "Your PC is infected with N viruses!" window plus Windows toasts saying "Turn on virus protection". Defender is clean, nothing is installed, every scan passes. Techs burn hours hunting a non-existent infection or reimage the machine.

**It is browser web-push.** The window is a web page. The toasts are Edge push notifications from an origin that was granted notification permission (one accidental "Allow"). The Windows tell is the **"via Microsoft Edge"** subtitle on the toast and a sender AUMID of the form `Microsoft.MicrosoftEdge.Stable_8wekyb3d8bbwe!https://<origin>/`. Fastest disproof: check the installed-software list. If the popup says McAfee and the box has no McAfee (Defender only), the popup is fake by definition.

Four traps make the cleanup fail silently:

1. **Edge rewrites `Preferences` on exit.** Edit it while Edge runs and your change is silently reverted when Edge closes. Nothing errors.
2. **"No windows" does not mean "not running".** Edge's startup boost / background mode launches the browser process with `--no-startup-window` at logon. That background Edge keeps delivering push toasts with no browser visible, which is exactly why it looks like a system-level infection.
3. **`MainWindowHandle` is `0` from SYSTEM.** RMM/agent scripts run as SYSTEM in session 0 and cannot see window handles in the user's session, so every process looks windowless. Deciding "safe to kill" from `MainWindowHandle` will happily kill a browser full of the user's work.
4. **There are two registries of the grant, not one.** Removing the Edge permission leaves the Windows-side sender registered, so the scam domain still appears under Settings > Notifications.

## WRONG
```powershell
# Trap 2+3: from SYSTEM, MainWindowHandle is always 0 -> this "no windows open" check is meaningless
if (@(Get-Process msedge).Where{$_.MainWindowHandle -ne 0}.Count -eq 0) { Stop-Process -Name msedge -Force }

# Trap 1: Edge still running -> this edit is discarded on exit, with no error
$j = Get-Content $prefs -Raw | ConvertFrom-Json
$j.profile.content_settings.exceptions.notifications.PSObject.Properties.Remove($bad)
$j | ConvertTo-Json -Depth 100 | Set-Content $prefs

# Blunt: kills the user's legitimate notifications (Teams, Vonage, Outlook) too
Set-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Edge' DefaultNotificationsSetting 2
```

## RIGHT
```powershell
# 1. ENUMERATE FIRST. Legit grants hide among the junk -- never blanket-block.
$prefs = "C:\Users\$u\AppData\Local\Microsoft\Edge\User Data\Default\Preferences"
$j = [System.IO.File]::ReadAllText($prefs,[System.Text.Encoding]::UTF8) | ConvertFrom-Json
$j.profile.content_settings.exceptions.notifications.PSObject.Properties | ForEach-Object {
  # last_modified = microseconds since 1601; *10 -> FileTime ticks
  "{0}  setting={1}  granted={2}" -f $_.Name, $_.Value.setting,
    ([DateTime]::FromFileTimeUtc([int64]$_.Value.last_modified * 10))
}

# 2. Detect a REAL window via the command line, not MainWindowHandle (works from SYSTEM).
$main = @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
          Where-Object { $_.CommandLine -notmatch '--type=' })
$bg   = @($main | Where-Object { $_.CommandLine -match '--no-startup-window' })
if ($main.Count -ne $bg.Count) { throw 'Edge has an interactive window - do not kill' }

# 3. Stop Edge, THEN edit, or the write is discarded on exit.
Stop-Process -Name msedge -Force; Start-Sleep 3
if (@(Get-Process msedge -EA SilentlyContinue).Count -ne 0) { throw 'Edge still running' }
# ... remove ONLY the malicious keys, keep legit ones, write with -Depth 100 (see powershell/convertto-json-depth-truncation.md)

# 4. Remove the Windows-side sender registration too (per-origin AUMID).
$base = "Registry::HKEY_USERS\$sid\SOFTWARE\Microsoft\Windows\CurrentVersion\Notifications\Settings"
Get-ChildItem $base | Where-Object { $_.PSChildName -like 'Microsoft.MicrosoftEdge*!http*' -and
                                     $_.PSChildName -match 'baddomain\.tld' } |
  Remove-Item -Recurse -Force

# 5. Purge toasts already sitting in Action Center.
Stop-Service 'WpnUserService_*' -Force
Remove-Item "C:\Users\$u\AppData\Local\Microsoft\Windows\Notifications\wpndatabase.db*" -Force
Start-Service 'WpnUserService_*'
```

## NOTES
- **Enumerate before you block.** A real case had 6 grants: 5 scam domains and `app.vonage.com`, the user's phone system. `DefaultNotificationsSetting=2` or a naive "remove all" would have silently broken her phone alerts. Keep an explicit allow-list and verify it survived.
- **Grant timestamps are the forensic story.** `last_modified` on each entry reveals the incident. Three grants landing within 14 seconds = one "click to continue" cascade; an older pair months earlier = this is a repeat, not a one-off, which changes the remediation from "clean it" to "apply a policy".
- **NTFS file tunneling will make you think the delete failed.** Delete `wpndatabase.db` and let Windows recreate it within ~15 s and NTFS restores the *original* `CreationTime` onto the new file (KB172190), so the fresh DB can show a creation date years old. Trust `LastWriteTime`, or verify by content.
- Verify the purge by scanning the DB **and its `-wal`** for the scam strings, reading through the service's lock -- see `kb/powershell/locked-file-read-false-clean.md`. A naive scan reports CLEAN having read nothing.
- Force-killing Edge can leave `profile.exit_type = "Crashed"`, which greets the user with a "restore pages?" prompt. Since you are rewriting `Preferences` anyway, set `exit_type = 'Normal'`.
- **Blocking specific URLs is whack-a-mole**: these kits generate a fresh random subdomain per visit (`d9bujq0hubcc73e4ue3g.<domain>`). Per-URL blocks have no future value. Durable fixes are `QuietNotificationPromptsEnabled` (kills the interruptive Allow prompt), or `DefaultNotificationsSetting=2` **plus** `NotificationsAllowedForUrls` allow-listing the legit origins, plus DNS filtering.
- Same layout applies to Chrome (`AppData\Local\Google\Chrome\User Data\<profile>\Preferences`); check every user profile and every browser profile dir, not just `Default`.
