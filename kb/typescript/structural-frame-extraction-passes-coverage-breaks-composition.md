---
tech: typescript
tags: [canvas, rendering, visual-regression, structural-extraction, owner-review, transparency]
severity: high
---
# Structural frame extraction can pass coverage tests while breaking composition

## PROBLEM

A canvas/frame-art refactor can preserve every measured component rectangle, native pixels,
transparency rule, and text-clearance region while producing visibly broken artwork. Extracted
motifs may become oversized empty wells, tiny orphan decorations, disconnected markers, or thin
rule borders that no longer read as one frame. Pixel/coverage tests stay green because they prove
that expected regions were painted or preserved, not that the assembled composition remains
coherent. A component output can therefore appear mechanically successful across eleven frame
families while an owner correctly rejects it at a glance.

## WRONG

```ts
const report = verifyStructuralExtraction(candidate);
expect(report.transparentPixelsPreserved).toBe(true);
expect(report.requiredComponentsCovered).toBe(true);
expect(report.clearanceFailures).toHaveLength(0);
// Green checks are incorrectly treated as approval to publish the extracted art.
```

## RIGHT

```ts
const report = verifyStructuralExtraction(candidate);
expect(report.transparentPixelsPreserved).toBe(true);
expect(report.requiredComponentsCovered).toBe(true);
expect(report.clearanceFailures).toHaveLength(0);

// Separate evidence: review every named section in the assembled frame.
for (const section of candidate.sections) {
  await reviewRenderedSection(section, {
    views: ["full", "mobile"],
    artwork: "real-card-art",
    check: ["connected framing", "readable motifs", "proportion", "intentional wells"],
  });
}
// Native-font pixel tests and explicit owner acceptance remain separate gates.
```

## NOTES

Treat the structural verifier as a floor, not a composition or acceptance oracle. Review each
named section at full and mobile scale against real card art; do not substitute blank canvases,
fixture-only crops, or one gallery thumbnail. Pass-through/exempt layouts must remain explicit
exceptions rather than being reported as false extraction defects. Native-font pixel tests prove
font-dependent paint behavior, while owner acceptance decides whether the resulting frame art is
coherent. Do not claim a revision (including Frog) is complete until that separate review and
acceptance evidence exists.
