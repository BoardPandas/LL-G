---
tech: rust
tags: [windows-rs, com, propvariant, wasapi, process-loopback, ffi, drop]
severity: high
---
# windows-rs PROPVARIANT has a Drop that frees a VT_BLOB pointing at Rust memory

## PROBLEM
windows-rs 0.62 adds `impl Drop for PROPVARIANT` (`src/extensions/Win32/System/StructuredStorage.rs`) that calls `PropVariantClear`. The raw struct looks like a plain `#[repr(C)]` binding, so it is natural to build a `VT_BLOB` whose `pBlobData` points at a local struct -- e.g. `AUDIOCLIENT_ACTIVATION_PARAMS` for `ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, ...)`. At scope exit the Drop `CoTaskMemFree`s that stack pointer and the process dies with no panic and no message (observed: bash exit 127). Everything before scope exit works, so the crash looks unrelated to the activation code.

## WRONG
```rust
let params = AUDIOCLIENT_ACTIVATION_PARAMS { /* ... */ };
let mut pv = PROPVARIANT::default();
let inner = &mut *pv.Anonymous.Anonymous;
inner.vt = VT_BLOB;
inner.Anonymous.blob = BLOB { cbSize: size_of_val(&params) as u32, pBlobData: &params as *const _ as *mut u8 };
ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&pv), &handler)?;
// scope ends: PropVariantClear -> CoTaskMemFree(&params) -> silent process death
```

## RIGHT
```rust
// The blob points at Rust memory: never let PropVariantClear run on it.
let mut pv = std::mem::ManuallyDrop::new(PROPVARIANT::default());
{
    let inner = &mut *pv.Anonymous.Anonymous;
    inner.vt = VT_BLOB;
    inner.Anonymous.blob = BLOB { cbSize: size_of_val(&params) as u32, pBlobData: &params as *const _ as *mut u8 };
}
ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, &IAudioClient::IID, Some(&*pv), &handler)?;
```

## NOTES
Only let a PROPVARIANT drop when COM allocated its payload (e.g. one returned by `IPropertyStore::GetValue`). Found building per-process loopback capture in Hark (2026-09-26). See also: wasapi-loopback-silence-gaps.md.
