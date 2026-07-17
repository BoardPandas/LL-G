---
tech: powershell
tags: [add-type, system-drawing, dotnet, type-forwarding, csharp, lockbits, images]
severity: medium
---
# Add-Type C# referencing System.Drawing fails on modern .NET (type forwarding)

## PROBLEM
Inline C# via Add-Type that uses System.Drawing types fails to compile under PowerShell 7
on modern .NET (observed on .NET 10). The types are forwarded across multiple assemblies
(System.Drawing.Common, System.Drawing.Primitives, System.Private.Windows.Core,
System.Private.Windows.GdiPlus), producing cascading CS1069/CS0012 errors; adding the
assemblies the errors name just surfaces the next private assembly in the chain, and
internal types like IImage/IBitmap live in assemblies not meant to be referenced.
Chasing -ReferencedAssemblies is a dead end.

## WRONG
```powershell
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies ([System.Drawing.Bitmap].Assembly.Location) -TypeDefinition @'
using System.Drawing;
public static class Shrink {
    public static void Run(string src) {
        using (Bitmap bmp = new Bitmap(src)) { /* LockBits pixel work */ }
    }
}
'@
# error CS0012: The type 'IImage' is defined in an assembly that is not referenced
# ('System.Private.Windows.GdiPlus') ... and so on, unresolvable
```

## RIGHT
```powershell
# Skip C# compilation entirely; call the same APIs directly from PowerShell.
Add-Type -AssemblyName System.Drawing
$bmp  = [System.Drawing.Bitmap]::new($src)
$rect = [System.Drawing.Rectangle]::new(0, 0, $bmp.Width, $bmp.Height)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
                      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$len = [Math]::Abs($data.Stride) * $bmp.Height
$px  = [byte[]]::new($len)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $len)
# ... process $px (use a 256-entry lookup table; per-pixel math is fine at ~250k bytes)
[System.Runtime.InteropServices.Marshal]::Copy($px, 0, $data.Scan0, $len)
$bmp.UnlockBits($data); $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
```

## NOTES
PowerShell method calls bind against the loaded assemblies at runtime, so type forwarding
is a non-issue there; it only breaks the C# compiler's reference resolution. Also seen in
the same session: [System.Drawing.Bitmap]::new(path) can throw "Parameter is not valid"
on OneDrive-redirected folders; loading via [IO.File]::ReadAllBytes into a MemoryStream
sidesteps it.
