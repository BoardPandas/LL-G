---
tech: media-foundation
tags: [mft, imftransform, d3d11, dxgi, hardware-encoder, setoutputtype, h264, nvenc, quicksync, com, windows]
severity: high
---
# A hardware encoder MFT will not accept a media type at all until you give it a Direct3D device

## PROBLEM

`MFT_MESSAGE_SET_D3D_MANAGER` reads like a performance option -- hand the
transform a device so frames can stay on the GPU. It is not. Any MFT that
advertises `MF_SA_D3D11_AWARE` treats the device as a **precondition for
configuration**, and without it `SetOutputType` / `SetInputType` fail before you
ever get near submitting a frame.

The expensive part is that each vendor fails differently, and one of them fails
silently. Measured on a single Windows 11 box with four hardware H.264 encoders
registered, all four advertising `MF_SA_D3D11_AWARE = 1`:

| Transform | Without a D3D manager |
|---|---|
| `AMDh264Encoder` | `SetOutputType` -> `MF_E_TRANSFORM_TYPE_NOT_SET` (0xC00D6D76), **in both type orders** |
| `Microsoft AVC DX12 Encoder` | `SetOutputType` -> `0x80041000` |
| `NVIDIA H.264 Encoder MFT` | **Accepts both media types, returns an event generator, accepts BEGIN_STREAMING and START_OF_STREAM -- then never queues `METransformNeedInput`, and `ProcessInput` returns `MF_E_NOTACCEPTING` forever** |

The AMD code is actively misleading: `MF_E_TRANSFORM_TYPE_NOT_SET` normally
means "set the *other* stream's type first", so it sends you off swapping input
and output order -- which is the one other well-known ordering rule in this API
and therefore very plausible. It fails in both orders, because the missing
thing is the device.

The NVIDIA case is worse: a rung that configures cleanly and then produces
nothing gives a fallback ladder no reason to fall through, so you ship a
"working" hardware path that yields a permanently black picture.

## WRONG

```go
// Types first, device later (or never) -- device treated as an optimisation.
transform, _ := activate.activateTransform()

attrs, _ := transform.getAttributes()
attrs.setUINT32(&mfTransformAsyncUnlock, 1) // necessary, but not sufficient
attrs.release()

if err := transform.setOutputType(0, outputType); err != nil {
    // AMD:   MF_E_TRANSFORM_TYPE_NOT_SET -> "must be the type order" (it isn't)
    // DX12:  0x80041000
    // NVIDIA: no error at all, and no frames either
    return err
}
transform.setInputType(0, inputType)
```

## RIGHT

```go
// Create one D3D11 device with VIDEO_SUPPORT, wrap it in a DXGI device
// manager, and hand it over BEFORE any media type. Only to transforms that
// ask: MFT_MESSAGE_SET_D3D_MANAGER to a transform without MF_SA_D3D11_AWARE
// (the software H.264 MFT, for one) is documented to fail.
device := d3d11CreateDevice(D3D_DRIVER_TYPE_HARDWARE,
    D3D11_CREATE_DEVICE_VIDEO_SUPPORT|D3D11_CREATE_DEVICE_BGRA_SUPPORT)

// Media Foundation drives the device from its own threads.
if mt, ok := device.queryInterface(IID_ID3D10Multithread); ok {
    mt.SetMultithreadProtected(true)
    mt.Release()
}

manager, resetToken := MFCreateDXGIDeviceManager()
manager.ResetDevice(device, resetToken)

if aware, _ := transformAttrs.getUINT32(&MF_SA_D3D11_AWARE); aware != 0 {
    transform.processMessage(MFT_MESSAGE_SET_D3D_MANAGER, uintptr(manager))
}

transform.setOutputType(0, outputType) // output first, then input
transform.setInputType(0, inputType)
```

## NOTES

- **Enumerate and try every candidate, not just the first.** `MFTEnumEx` on a
  multi-GPU box returns several encoders and the first is not always usable --
  on the machine above, `AMDh264Encoder` appeared twice and refused
  `MFT_MESSAGE_SET_D3D_MANAGER` outright with `E_FAIL` (it reports
  `MF_SA_D3D_AWARE` too, i.e. it wants the older D3D9 device manager), while
  NVIDIA's worked. A ladder that took the first answer would have fallen back
  to software with an idle GPU.
- A hardware MFT given a device still accepts **system-memory** input samples,
  so this is worth doing even when your capture path is CPU-side (GDI BitBlt)
  and you have no GPU surface to pass. The device is needed to configure the
  transform, independently of where the pixels live.
- Keep the device alive for the life of the process rather than per encoder.
  Destroying and recreating one around a transform's lifetime raced the
  driver's own teardown and killed the process on a Media Foundation worker
  thread -- no catchable exception, since it is not on a thread the runtime
  owns.
- Related: `mft-stream-notify-constants-transposed.md` produces a very similar
  "NVIDIA accepts everything and never asks for input" symptom, so check both
  before blaming the driver.
