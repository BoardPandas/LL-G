---
tech: data-viz
tags: [normalization, charting, scale, clamping, ui-rendering, dashboard, bar-chart]
severity: high
---
# One normalization divisor across mixed-scale metrics silently clamps the chart

## PROBLEM
When several metrics that live on DIFFERENT scales are rendered (or normalized) through ONE shared divisor / normalization constant, that constant can only be correct for one of the scales. The others are silently distorted: larger-scale metrics overshoot 1.0 and clamp to a full bar; smaller-scale metrics collapse toward an empty bar. It is silent because the clamp produces a plausible-looking value (a full bar, a tiny bar) instead of throwing -- the chart ships looking fine while conveying no information.

Real case (tcg dashboard, `eval-tab.js` "Power Profile"): five axis bars where four are 0..100 saturating scores (Clock / Interaction / Resilience / Finisher) and the fifth is a 1.0..3.0 throughput multiplier (Value-to-turn). The bar code divided EVERY axis value by 10 before mapping to width. Any 0..100 score above 10 became a fraction > 1 and clamped to a full bar, so all four pinned full on essentially every deck; only the ~1..3 multiplier produced a real width. Four of five bars were meaningless and nobody saw an error.

Heuristic tell: when N bars all pin to the same extreme (all full, or all empty) regardless of input, suspect a single normalization constant applied across heterogeneous units.

## WRONG
```js
// One divisor for every axis -- only correct for ONE of the scales.
const DIV = 10;
for (const a of axes) {
  const frac = Math.min(1, a.value / DIV); // 0..100 score / 10 -> >1 -> clamps to full
  bar.style.width = `${frac * 100}%`;
}
// Clock=59 -> 5.9 -> 100%.  Interaction=71 -> 100%.  VtT(multiplier)=1.8 -> 18%.
// Four 0..100 axes saturate; only the 1..3 multiplier renders a meaningful width.
```

## RIGHT
```js
// Each metric maps its OWN domain to [0,1]. Tag the unit/kind; never share a divisor.
function frac(a) {
  if (a.kind === "ratio")               // multiplier: 1.0 floor .. 3.0 cap
    return Math.min(1, Math.max(0, (a.value - 1) / 2)); // 1.0->0, 3.0->1
  return Math.min(1, Math.max(0, a.value / 100));        // 0..100 score -> 0..1
}
for (const a of axes) bar.style.width = `${frac(a) * 100}%`;
// Clock=59 -> 59%.  Interaction=71 -> 71%.  VtT=1.8 -> 40%.  Each bar reads its value.
```

## NOTES
The clamp (`Math.min(1, ...)`) is what makes the bug silent: without it an over-1 fraction would visibly overflow the track and you would notice. Clamping hides the unit mismatch behind a tidy full bar.

The same failure appears anywhere mixed-unit series share a scale: a shared y-axis domain across a count series and a percentage series, a color ramp keyed to one metric's range applied to another, a single `max` used to normalize heterogeneous sparklines. Carry the domain (or kind) with each series and map per-series, not per-chart.

Sibling of the source-of-truth / data-ownership drift family in the architecture index (one path forced to serve heterogeneous concerns). Real fix landed in the tcg dashboard `eval-tab.js` Power Profile via per-axis kind mapping (commit 87ae20e).
