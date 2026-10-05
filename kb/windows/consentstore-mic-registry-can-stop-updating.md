---
tech: windows
tags: [microphone, meeting-detection, consentstore, capabilityaccessmanager, registry, core-audio, wasapi, audio-session, packaged-apps, teams, rust, windows-rs]
severity: high
---
# The ConsentStore microphone registry can stop updating; detect live mic use with Core Audio sessions

## PROBLEM
A common way to answer "which app is using the microphone right now" on Windows is to read
`HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone`:
packaged apps are subkeys named by package family, desktop apps sit under `NonPackaged\<path with # for \>`,
and an entry is "in use" while `LastUsedTimeStart > 0 && LastUsedTimeStop == 0`. It is cheap, needs no
permission, and `RegNotifyChangeKeyValue` on the parent key gives instant change events.

It is undocumented, and it can silently freeze. On Windows 11 build 26300 (26H2), after the
cumulative updates installed on 2026-10-03, every value under that key stopped changing: the
detecting app's own permanently open capture stream read as stopped two days earlier, and a full
Teams call left no trace at all (`MSTeams_8wekyb3d8bbwe` still showed the previous call). Nothing
errored: the key opened, the values parsed, the change watcher armed and simply never fired again.
Meeting auto-detection stopped offering to record, and a manually started recording could not
"adopt" the call, so it never auto-stopped at hang-up. Windows 11 also tracks capability usage in
a database under `C:\ProgramData\Microsoft\Windows\CapabilityAccessManager\` (the
`CapabilityAccessManager.db-wal` that ballooned until KB5095093), but that is just as undocumented,
so it is no safer a replacement.

Diagnose it by comparing the registry with Core Audio: if your own process holds an open capture
stream but its ConsentStore entry has a non-zero `LastUsedTimeStop`, the registry is stale.

## WRONG
```rust
// Reads an undocumented store that Windows may stop writing, with no error when it does.
let root = RegKey::predef(HKEY_CURRENT_USER).open_subkey(CONSENT_MIC)?;
for name in root.enum_keys() {
    let key = root.open_subkey(name?)?;
    let start: u64 = key.get_value("LastUsedTimeStart").unwrap_or(0);
    let stop: u64 = key.get_value("LastUsedTimeStop").unwrap_or(0);
    let in_use = start > 0 && stop == 0; // false forever once the store freezes
}
```

## RIGHT
```rust
// Documented API: every audio session on every ACTIVE capture endpoint (not just the default
// mic -- Teams may capture from a Krisp/virtual mic), kept while a stream is running.
let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
let endpoints = enumerator.EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE)?;
for i in 0..endpoints.GetCount()? {
    // Skip one endpoint on error (a headset unplugged mid-poll) instead of failing the poll.
    let Ok(device) = endpoints.Item(i) else { continue };
    let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
    let sessions = manager.GetSessionEnumerator()?;
    for j in 0..sessions.GetCount()? {
        let session = sessions.GetSession(j)?;
        if session.GetState()? != AudioSessionStateActive { continue; }
        let pid = session.cast::<IAudioSessionControl2>()?.GetProcessId()?;
        if pid == 0 { continue; } // system-sounds session
        // Name it like the ConsentStore did: package family if packaged, else exe path.
        // GetPackageFamilyName(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, ..)) returns
        // MSTeams_8wekyb3d8bbwe for ms-teams.exe AND its msedgewebview2.exe children;
        // APPMODEL_ERROR_NO_PACKAGE means fall back to QueryFullProcessImageNameW.
    }
}
```

## NOTES
- windows-rs 0.62 features: `Win32_Media_Audio`, `Win32_System_Com`,
  `Win32_System_Com_StructuredStorage` + `Win32_System_Variant` (gate on `IMMDevice::Activate`),
  `Win32_Storage_Packaging_Appx` (`GetPackageFamilyName`), `Win32_System_Threading`.
- Initialize COM on the calling thread (`CoInitializeEx(MTA)`, balanced by `CoUninitialize`); if it
  returns `RPC_E_CHANGED_MODE` the thread is already STA, which Core Audio also serves -- proceed
  and do not uninitialize. Bind the guard first so it drops after every interface.
- A snapshot cost ~3 ms, so a 2 s poll is cheap. Event-driven alternatives exist
  (`IAudioSessionNotification::OnSessionCreated` + per-session `IAudioSessionEvents::OnStateChanged`
  + `IMMNotificationClient`) but need per-session subscription bookkeeping; whichever wakes you,
  debounce/auto-stop deadlines still need their own timers (see
  registry-notifications-do-not-drive-time-deadlines.md).
- Treat a probe error as transient and retry at the next poll: Core Audio fails while the Windows
  Audio service restarts (driver update, Bluetooth headset). Latching "detection off for this
  session" on the first error turns a 2-second blip into a dead feature.
- Packaged-app WebView2 helpers inherit the app's package identity, but the Windows shell's own
  WebView2 processes report `MicrosoftWindows.Client.CBS_cw5n1h2txyewy` -- match on an allow-list,
  never "any packaged process".
- See also meet-prejoin-mic-is-not-call-membership.md: an open mic means the lobby as often as the call.
