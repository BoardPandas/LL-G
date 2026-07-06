---
tech: wpf
tags: [dispatchertimer, timer-resolution, timebeginperiod, winmm, fps, animation, easing, frame-rate]
severity: medium
---
# DispatcherTimer is capped near 64 Hz by the default ~15.6 ms Windows timer resolution

## PROBLEM
Setting a `DispatcherTimer.Interval` below ~15.6 ms does not make it fire
faster. Windows' default system timer resolution is ~15.6 ms (64 ticks/s),
and DispatcherTimer (like most Win32 timers) is quantized to it. A render
loop configured for 144 or 240 fps silently runs at ~64 fps: no error, no
warning, the interval property reads back exactly what you set. Users just
see the "high fps" setting doing nothing above 60.

Sub-lesson: if per-tick easing/decay coefficients are constants tuned for
one tick length, changing the frame rate changes animation speed. A meter
that decays 0.45 per 100 ms tick decays ~4x faster when the same constant
is applied per 25 ms tick. Fixing the timer cap without rescaling the
coefficients trades one bug for another.

## WRONG
```csharp
// "240 fps" overlay that actually ticks at ~64 Hz:
_tick = new DispatcherTimer(DispatcherPriority.Render);
_tick.Interval = TimeSpan.FromMilliseconds(1000.0 / 240); // quantized to ~15.6 ms
_tick.Tick += (_, _) => RenderFrame();
_tick.Start();

// and frame-rate-dependent ballistics baked in as constants:
const double ReleaseEasing = 0.45; // tuned for a 100 ms tick, wrong at any other rate
```

## RIGHT
```csharp
[DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
[DllImport("winmm.dll")] static extern uint timeEndPeriod(uint ms);

// Request 1 ms resolution only when the target rate needs it (> 60 fps),
// and ALWAYS release it (Closed handler) - it is a system-wide power drain.
void SetHighResTimer(bool on)
{
    if (on == _highResTimer) return;
    _highResTimer = on;
    if (on) timeBeginPeriod(1);
    else timeEndPeriod(1);
}

var fps = Math.Clamp(settings.OverlayFps, 30, 240);
var intervalMs = 1000.0 / fps;
_tick.Interval = TimeSpan.FromMilliseconds(intervalMs);
SetHighResTimer(fps > 60);

// Rescale per-tick coefficients to the actual tick length so decay speed
// is identical at 30 or 240 fps (exponential form, not linear scaling):
void SetTickInterval(double intervalMs)
{
    _attackEasing  = 1 - Math.Pow(0.25, intervalMs / 33.0);   // 0.75 per 33 ms reference
    _releaseEasing = 1 - Math.Pow(0.55, intervalMs / 100.0);  // 0.45 per 100 ms reference
    _trailDecay    = Math.Pow(0.93, intervalMs / 100.0);      // x0.93 per 100 ms reference
}
```

## NOTES
- `timeBeginPeriod(1)` raises the timer resolution for the whole OS and
  increases power draw; every `timeBeginPeriod` call must be paired with a
  matching `timeEndPeriod` (same value) when the high rate is no longer
  needed, not just at process exit.
- Windows 10 2004+ scopes the raised resolution to the requesting process
  in some cases, but treat it as system-wide and release it anyway.
- Coefficient rescaling: for an easing step `disp += (target - disp) * c`
  the frame-rate-independent form is `c = 1 - Math.Pow(1 - cRef, intervalMs / refMs)`;
  for a decay multiplier it is `d = Math.Pow(dRef, intervalMs / refMs)`.
  Linear scaling (`c * intervalMs / refMs`) drifts and can overshoot past 1.
- For per-frame animation, `CompositionTarget.Rendering` fires per WPF
  frame without the timer-resolution issue, but it runs at the monitor
  refresh rate and cannot be throttled to a chosen fps without extra work.
- Found in DeafDirectionalHelper commit 4542e66
  (View/Overlays/OverlayWindow.cs + LevelEngine.SetTickInterval): overlay
  FPS setting of 144/240 silently rendered at ~64 fps until
  timeBeginPeriod(1) was requested for fps > 60, released on window close;
  meter ballistics were rescaled in the same commit (2026-07).
