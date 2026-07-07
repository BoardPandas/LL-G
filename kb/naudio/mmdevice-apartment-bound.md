---
tech: naudio
tags: [wasapi, com, threading, mmdevice, apartment, wpf, crash]
severity: high
---
# MMDevice RCWs are apartment-bound; cross-thread access throws E_NOINTERFACE

## PROBLEM
NAudio's `MMDevice` wraps WASAPI COM interfaces (`IMMDevice`, `IAudioMeterInformation`)
that have **no registered marshaling proxy/stub**. A device object created on one
thread (e.g. an MTA background audio-poll thread) cannot be dereferenced from
another apartment (e.g. the WPF STA UI thread). The failing call throws:

```
System.InvalidCastException: Unable to cast COM object of type 'System.__ComObject'
to interface type 'NAudio.CoreAudioApi.Interfaces.IMMDevice'. ... E_NOINTERFACE (0x80004002)
```

On a WPF `DispatcherTimer`, that exception is unhandled and **kills the whole app**.

The failure is intermittent and misleading: if the device happens to have been
created on the UI thread (e.g. an initial selection in a constructor), UI reads
work fine - until the background thread re-selects a device (game audio starts,
default device changes), after which the very next UI-thread read crashes. It
presents as "the app randomly crashes during gameplay."

## WRONG
```csharp
// Background thread selects/reads the device every 50 ms:
Task.Run(() => { while (true) { endpoint.EnsureSelected(); ReadMeters(endpoint.Current); ... } });

// UI status timer, 1 s - crashes after the background thread re-selects:
statusTimer.Tick += (_, _) =>
    label.Text = $"{endpoint.Current?.AudioMeterInformation.PeakValues.Count}-channel device";
```

## RIGHT
```csharp
// Selector caches plain values at selection time, on the owning thread:
private string? _deviceName;
private int _channelCount;
// ... on select/switch:
_deviceName = device.FriendlyName;
_channelCount = device.AudioMeterInformation.PeakValues.Count;

public string CurrentDeviceName => _deviceName ?? "None"; // safe from any thread
public int CurrentChannelCount => _channelCount;          // safe from any thread

// UI reads the cached fields only; the MMDevice itself is documented as
// owned by the audio thread and never exposed to UI code paths.
```
Also avoid creating the initial device on the UI thread "for convenience" - let
the polling thread's first tick select it, so exactly one thread ever owns it.

## NOTES
- `FriendlyName` is itself a slow property-store COM read - caching it also
  removes a per-tick perf hit.
- Windows Event Viewer is the fastest confirmation: Application log, sources
  `.NET Runtime` (1026) + `Application Error` (1000) carry the full stack trace
  even for a WPF app with no console.
- Same rule applies to `AudioSessionControl` and session managers: enumerate
  and read them on the thread that created the enumerator.
- Found in DeafDirectionalHelper (2026-07): settings-window status line read
  `Current.AudioMeterInformation` from a 1 s UI timer while a 50 ms background
  thread owned the device; app died whenever the capture endpoint switched
  with the settings window open.
