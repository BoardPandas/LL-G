---
tech: voicemeeter
tags: [pan, parameters, macro-buttons, remote-api, clamping, third-party-docs, silent-failure]
severity: high
---
# Strip Pan_x runs -0.5 to +0.5, not -1.0 to +1.0

## PROBLEM
`Strip[i].Pan_x` in the Voicemeeter Remote API has a documented range of
**-0.5 (hard left) to +0.5 (hard right)**, with `0` as centre. Third-party
tutorials, Stream Deck / Macro Deck plugin wikis, and AI-generated answers
routinely state `±1.0` instead.

The error survives testing because Voicemeeter **clamps out-of-range values
silently**. There is no error channel in the script language at all - a bad
request is discarded or clamped with no feedback. So `Pan_x = -1.0` clamps to
`-0.5` and produces exactly the hard-left result you expected. The macro
"works", you record ±1.0 as the range, and the bug only surfaces later in
anything that computes an intermediate value:

- A "half left" of `-0.5` is actually **fully** left.
- A stepped sweep from `0` to `-1.0` reaches the left wall at the midpoint and
  then sits still for the remaining half of its steps.
- A slider or MIDI CC mapped 0-127 across ±1.0 does nothing across its outer
  quarters at each end.

Vendor source: Voicemeeter Potato user manual p.67, Banana p.56, and the
identical table in `VoicemeeterRemoteAPI.pdf`. Note the range is genuinely
irregular and cannot be guessed from `Pan_x`: the sibling `Pan_y` is `0 to 1.0`,
*except* on the virtual-strip 5.1 pan pot where it becomes `-0.5 to 0.5`.

## WRONG
```text
// "hard left" - happens to work, by clamping
Strip(3).Pan_x = -1.0;

// halfway left - actually FULLY left
Strip(3).Pan_x = -0.5;

// a sweep that stalls halfway through
Strip(3).Pan_x = -0.25; Wait(50);
Strip(3).Pan_x = -0.50; Wait(50);   // already at the wall
Strip(3).Pan_x = -0.75; Wait(50);   // no audible change
Strip(3).Pan_x = -1.00;             // no audible change
```

## RIGHT
```text
// Full scale is -0.5 .. +0.5
Strip(3).Pan_x = -0.5;   // fully left
Strip(3).Pan_x =  0;     // centre
Strip(3).Pan_x = +0.5;   // fully right

Strip(3).Pan_x = -0.25;  // genuinely halfway left

// a sweep that uses the whole range
Strip(3).Pan_x = -0.1; Wait(50);
Strip(3).Pan_x = -0.2; Wait(50);
Strip(3).Pan_x = -0.3; Wait(50);
Strip(3).Pan_x = -0.4; Wait(50);
Strip(3).Pan_x = -0.5;
```

Same names apply through `VoicemeeterRemote.dll`, so the range is identical for
`VBVMR_SetParameterFloat("Strip[3].Pan_x", -0.5f)`.

## NOTES
- **The general lesson: a silently-clamped parameter cannot be range-checked by
  experiment at its extremes.** Both a correct and an over-wide range produce
  identical behaviour at the limits, so the only test that distinguishes them is
  a midpoint. When a vendor API clamps instead of erroring, take ranges from the
  vendor table, never from observed behaviour or third-party docs.
- Other Voicemeeter ranges that are irregular in the same way, and are worth
  reading rather than assuming: `Strip[i].App[k].Gain` is **linear 0.0-1.0**, not
  dB, while `Strip[i].Gain` is **-60 to +12 dB**; `Bus[i].Mono` is **tri-state**
  0/1/2 (2 = stereo reverse), not boolean; and `System.SendMidi(..., "data", ...)`
  takes **hexadecimal** values while every other `SendMidi` form takes decimal
  0-127.
- Corroborating detail on the third-party side: the BarRaider Stream Deck plugin
  docs, frequently cited as the source of the ±1.0 figure, do **not** actually
  state a range - they defer to the official API PDF. The ±1.0 value appears to
  be invention propagated between tutorials and AI answers rather than a
  misreading of any real document.
- Related trap when verifying a pan macro by eye: on Banana/Potato **physical**
  strips the 2D panel defaults to the IntelliPan COLOR view, so `Pan_x` moves the
  audio while the on-screen dot stays put. The vendor SDK header
  (`VMRTSTATE_MODE_PAN0 / PANCOLOR / PANMOD`) shows it is one widget with three
  modes. Verify by ear or on the bus meters, not by watching the panel.
- Found 2026-08-14 while building a MacroButtons keybind to toggle balance
  between fully-left and centre.
