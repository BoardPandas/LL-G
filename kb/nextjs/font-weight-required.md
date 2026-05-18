---
tech: nextjs
tags: [next-font, google-fonts, fonts, next-build, instrument-serif]
severity: high
---
# Non-variable Google fonts loaded via next/font/google require an explicit weight

## PROBLEM
next/font/google distinguishes variable fonts (one file spanning a weight axis) from non-variable / static fonts (one file per weight). For a variable font you may omit `weight` and the whole axis is available. For a non-variable font you MUST pass an explicit `weight`, and the value must be one of the weights that font actually ships. `next build` fails with "Missing weight ..." if `weight` is omitted, and "Unknown weight ..." if you pass a weight the font does not publish. Instrument Serif, for example, ships only weight 400. Copying a `weight: ["400","700"]` array from a previously-working variable font (or a different static font) is the trap: it looks correct, passes review, and fails the build.

## WRONG
```ts
import { Instrument_Serif } from "next/font/google";

// Omitting weight -> next build: "Missing weight for font `Instrument_Serif`"
const serif = Instrument_Serif({ subsets: ["latin"], variable: "--font-serif" });

// Copying a prior font's weights -> next build: "Unknown weight `700` for font `Instrument_Serif`"
const serif2 = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-serif",
});
```

## RIGHT
```ts
import { Instrument_Serif } from "next/font/google";

// Non-variable font: pass exactly the weight(s) the font publishes (Instrument Serif = 400 only)
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-serif",
});
```

## NOTES
Before adding a static Google font, check fonts.google.com for the weights it actually offers; do not assume 400/700. Variable fonts (e.g. Inter, Geist) may omit `weight` entirely. The error only surfaces at `next build` / `next dev` compile time, not at lint or typecheck.
