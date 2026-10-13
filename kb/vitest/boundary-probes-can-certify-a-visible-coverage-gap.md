---
tech: vitest
tags: [visual-regression, image-tests, boundary-coverage, false-green, independent-oracle]
severity: high
---
# Boundary probes can certify a visible coverage gap

## PROBLEM

A coverage test labels one pixel just beyond the proposed background rectangle as
"exterior" and asserts that it stays unchanged. If the rectangle stops before the
actual decorative border, that pixel is still panel interior. The test passes
precisely because the visible gap remains. Checking that a rendered image matches
its declared geometry does not prove that the geometry matches the artwork.

The same mistake can hide in hand-authored evidence: source hashes and a correct
renderer faithfully reproduce an incorrectly classified probe. Transparent
source pixels do not distinguish an interior opening from exterior space.

In a 1500x2100 card-frame review, the background ended at half-open row 1918.
Evidence called (750,1918) exterior, although the center rail started at 1922
and varied across columns. Automated checks passed; visual review found the
bright slit. The safe corrected endpoint was 1933, within the continuous rail.

## WRONG

```ts
// This derives the expected domain from the implementation being tested.
const firstUnpaintedRow = wash.y0 + wash.height;
const exterior = { x: 750, y: firstUnpaintedRow };
expect(rendered.pixel(exterior)).toEqual(bare.pixel(exterior));

// Hard-coding the same mistaken classification is no more independent.
expect(rendered.pixel({ x: 750, y: 1918 }))
  .toEqual(bare.pixel({ x: 750, y: 1918 }));
```

These assertions may be valid no-spill checks only AFTER the points have been
independently established as outside the intended panel.

## RIGHT

Measure the intended interior, decorative rail and genuine exterior from the
source artwork first. Preserve those measurements and their source hash
separately from the proposed fill. Then test actual renderer output across the
required boundary domain, including columns away from the center.

The rendering/measurement helpers below stand for the project's own fixture
harness; the key is which source defines each expectation.

```ts
const measured = loadSourceBoundPanelFixture(); // independent artwork evidence
expect(hash(sourceArtwork)).toBe(measured.sourceHash);

const bare = renderProductionFrame({ rulesOpacity: 0 });
for (const opacity of [0.45, 0.5, 1]) {
  const actual = renderProductionFrame({ rulesOpacity: opacity });
  let tested = 0;
  for (const point of measured.requiredLowerInteriorPixels) {
    assertBackdropComposite({
      actual: actual.pixel(point),
      bare: bare.pixel(point),
      placedFrame: placedArtwork.pixel(point),
      opacity,
    });
    tested++;
  }
  expect(tested).toBe(measured.expectedInteriorPixelCount);
  for (const point of measured.trueFooterExteriorPixels) {
    expect(actual.pixel(point)).toEqual(bare.pixel(point));
  }
}

// Prove the regression distinguishes the known bad boundary.
expect(coverageReport(renderWithOldBounds(), measured).complete).toBe(false);
expect(coverageReport(renderWithCorrectedBounds(), measured).complete).toBe(true);
```

Also check that the new endpoint lies inside a continuous painted rail over the
whole fill width for every palette/variant, rather than simply moving the
unverified single-point assumption to a lower row.

## NOTES

- The observed fix checked all 6,558 transparent interior pixels in the missed
  ten-row band, plus seven palette rails. Row 1932 had alpha at least 247 over
  x=[52,1448); genuinely exterior footer probes were at row 1950.
- Those coordinates/counts are incident evidence, not universal defaults.
  Different artwork requires fresh measurements; an irregular boundary may need
  a per-column trace rather than one rectangle.
- Near-opaque rails still blend. Compare expected source-over compositions and
  use independently justified encoding tolerances, not equality against a
  different backdrop. See [Near-opaque pixels still blend with their backdrop](near-opaque-pixels-still-blend-with-backdrop.md).
- Mutation-test the oracle by restoring the old endpoint or deliberately
  shrinking coverage. Do not weaken the interior domain to make that case pass.
- Keep the original failed proof/evidence and label its replacement explicitly.
  Full-resolution and mobile visual review remain necessary alongside tests.
- Enforcement in the source project already exists in
  `proxy-pipeline/src/lib/frame-rules-backdrop-mycelium.test.ts`: seven palette
  checks plus a real-render lower-band regression. This is a testing-oracle
  defect, not an assistant-hook/configuration defect.
