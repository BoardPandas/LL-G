---
tech: vitest
tags: [visual-regression, canvas, fonts, glyph-clearance, artifact-provenance, preview-packaging, false-green]
severity: high
---
# Visual tests can certify a different recipe than the published preview

## PROBLEM

A glyph-clearance or background-coverage test can pass while the published
preview still overlaps ornament or leaves a bright gap. The test is correct
for its inputs, but it is not testing the recipe that produced the preview.

Two independent input mismatches caused this during card-frame authoring:

1. A direct clearance scan drew text before loading the actual card font.
   Canvas fallback produced different glyph pixels and falsely cleared a
   shallow P/T plate. The production font exposed the overlap.
2. Full-interior coverage tests used independently measured bounds, but later
   packaging copied generic widths or an earlier bottom endpoint. Asset hashes
   were valid because only the coverage sidecar was wrong. Testing the correct
   rectangle did not certify the rectangle in the shipped proof.

In the observed batch, Cats and Cats-and-Dogs packages used generic horizontal
bounds, and Bunnies stopped one native pixel short. These were caught before
publication by comparing the final sidecars to the independent test fixtures.

## WRONG

These examples use schematic project-harness helpers, not public framework APIs.

```ts
// Naming the intended font does not establish that it has been loaded.
ctx.font = '61px "CardPT"';
const glyphs = rasterizeText(ctx, "123/123");
expect(clearanceFailures(glyphs, plate)).toBe(0); // possibly fallback ink

// A passing unit test does not certify later packaging inputs.
expectCoverage(render({ wash: auditedBounds }), independentInterior);
const candidate = packageFrame({ wash: genericBounds, assets: sameAssets });
expect(hashAssets(candidate)).toBe(hashAssets(sameAssets));
publish(previouslyRenderedReview); // no binding to the tested sidecar
```

## RIGHT

Initialize the renderer's exact font resources before rasterizing text. Verify
registration/selection, font inputs and nonempty ink, not only the CSS font
family string. Keep glyph size, baseline and placement identical to production.

```ts
await initializeProductionFonts();
expect(loadedFontFileHashes()).toEqual(fixture.fontFileHashes);

for (const text of ["3/4", "12/12", "123/123"]) {
  const glyphs = renderProductionTextOnly(text, fixedTextGeometry);
  expect(glyphs.opaquePixelCount).toBeGreaterThan(0);
  expectQuietSupport(glyphs, placedPlate, independentQuietMask);
}

// Audit the EXACT package that will render the published proofs.
expect(candidate.rulesWash).toEqual(independentlyAuditedWash);
const sidecarBytes = await readFile(candidate.sidecarPath);
const review = await renderFreshReview(candidate);

expect(review.manifest.rulesBackdropHash).toBe(sha256(sidecarBytes));
expect(review.manifest.recipeHash).toBe(finalAuthoringRecipeHash);
expect(review.manifest.assets).toEqual(hashAllFrozenCandidateAssets(candidate));

// Every compressed viewing copy must identify its exact source proof.
verifyCatalogSourceProofHashes(catalog, review);
verifyViewingCopyHashes(catalog);
```

Run the coverage test through this bound candidate or explicitly assert that
its bounds equal the independently tested fixture. Check complete interior and
bottom strips, underlap beneath real alpha, and genuine exterior/footer regions.
Mutating the bottom endpoint or substituting another family's sidecar must fail.

## NOTES

- The measured bounds are half-open native-pixel ranges. Do not copy one
  family's coordinates to another or derive expected bounds from the candidate.
- Regenerate incorrectly proportioned artwork around fixed content positions.
  Do not shrink text or relax clearance thresholds to accept a shallow plate.
- Use raw pixels or PNG for numerical compositing tests. Keep separate visual
  review of actual encoded/exported images at full size and phone size.
- Recipe/source hashes establish identity, not artistic acceptance. Preserve
  failed sources and regenerate stale proofs into new output directories.
- In the source project, glyph/coverage regressions already existed; the final
  package audit added sidecar-to-tested-bounds and proof-manifest checks.
  This is a rendering/test-input mismatch, not an assistant-hook defect; no
  Claude wiring check is appropriate.
- Related: [Quiet glyph support](../magic-tcg/hash-bound-clearance-rectangles-do-not-prove-quiet-glyph-support.md),
  [Boundary coverage probes](boundary-probes-can-certify-a-visible-coverage-gap.md),
  [Lossy pixel comparisons](../browser/lossy-image-output-invalidates-pixel-comparisons.md).
