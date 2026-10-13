---
tech: typescript
tags: [canvas, fonts, unicode, glyphs, fallback, rendering]
severity: high
---
# Mapped-empty font glyphs block canvas fallback

## PROBLEM

A font can map a character to an empty glyph with a positive advance width. The
character passes cmap and `measureText()` checks but paints no ink. Because the
mapping exists, a later font in the fallback stack is never consulted. A separate
failure occurs when a character has no mapping and the renderer paints its
missing-glyph box instead.

This was reproduced with `@napi-rs/canvas` 1.0.9 and bundled legacy fonts: 68
non-formatting Latin-1/Extended-A characters remained blank in the regular and
italic stacks even with an explicit Noto Serif fallback. Generic `serif` and
`sans-serif` also failed to select separately registered Noto in the tested
environment. Registering Noto under the primary font's alias did not merge glyph
coverage; face and weight selection could replace ordinary text instead.

## WRONG

```typescript
GlobalFonts.registerFromPath("Legacy.ttf", "Card Text");
GlobalFonts.registerFromPath("NotoSerif-Regular.ttf", "Card Text");
ctx.font = '40px "Card Text", serif';
const supported = ctx.measureText("Ă").width > 0;
// Positive advance is not evidence of a visible or correct glyph.
```

## RIGHT

Bundle and pin the fallback files, give each face a distinct alias, and fail
explicitly when a required registration fails. Keep supported text on the primary
face. For mapped-empty characters, select the fallback for the actual text run
before measuring, wrapping, and painting it.

```typescript
for (const { path, alias } of [
  { path: "Legacy.ttf", alias: "App Primary" },
  { path: "NotoSerif-Regular.ttf", alias: "App Unicode" },
]) {
  if (!GlobalFonts.registerFromPath(path, alias)) {
    throw new Error(`Required font registration failed: ${path}`);
  }
}

// Populate this parameter from a raster audit of the exact shipped font files.
function fontForRun(text: string, px: number, blankGlyphs: ReadonlySet<string>) {
  const hasBlank = [...text].some((character) => blankGlyphs.has(character));
  const stack = hasBlank
    ? '"App Unicode", serif'
    : '"App Primary", "App Unicode", serif';
  return `${px}px ${stack}`;
}

const previousFont = ctx.font;
ctx.font = fontForRun(text, 40, auditedBlankGlyphs);
try {
  const advance = ctx.measureText(text).width;
  ctx.fillText(text, x, y);
  x += advance;
} finally {
  ctx.font = previousFont;
}
```

## NOTES

- Rasterize every non-formatting character in the claimed coverage range. Assert
  nonzero ink and reject missing-glyph signatures; width alone catches neither
  failure. Include composed and decomposed accent strings and each typography
  role, plus byte-identical controls for previously supported text.
- Test with system-font discovery disabled in the production base image. The
  verified Linux Node 24 case had zero system fonts, 1,110 Latin glyph checks,
  65 accent-string checks, and five unchanged ASCII controls. This establishes
  the audited range, not universal Unicode, CJK, or emoji coverage.
- Wrapping, line-width calculation, drawing, and cursor advancement must resolve
  the same run with the same font. Selecting a whole-paragraph fallback during
  layout and reverting to per-word primary fonts during drawing causes drift.
- If required registration can be retried after partial failure, remember each
  successful alias so retries do not accumulate duplicate native registrations.
- Related: [Canvas text containment does not prove optical centering](canvas-text-containment-does-not-prove-optical-centering.md).
