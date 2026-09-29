---
tech: docx
tags: [docx, ooxml, word, bold, styles, docx-js]
severity: high
---
# Bold is a toggle: a bold run inside a bold style renders regular

## PROBLEM
In WordprocessingML, `w:b` (and `w:i`, `w:caps`, `w:strike` and the other toggle properties) is not a plain on/off flag when it comes from **styles**. A bold character style applied inside a bold paragraph style **toggles bold off**: bold + bold = not bold. So "make the emphasis bold" inside a heading that is already bold renders the emphasis in the regular weight.

It is silent: the XML is valid, every layer says "bold", and a unit test that asserts `bold: true` on the run passes. It gets worse with display fonts that ship only a bold weight (Poppins Bold installed as its own family, for example): when the toggle turns bold off, Word looks for the regular weight, does not find it, and substitutes a different font entirely. The heading comes out in the wrong typeface with no warning.

## WRONG
```xml
<!-- styles.xml: bold in the paragraph style AND in a character style -->
<w:style w:type="paragraph" w:styleId="Heading2">
  <w:rPr><w:rFonts w:ascii="Poppins" w:hAnsi="Poppins"/><w:b/></w:rPr>
</w:style>
<w:style w:type="character" w:styleId="LeadIn">
  <w:rPr><w:b/></w:rPr>
</w:style>

<!-- document.xml: the LeadIn run renders REGULAR (and may fall back to another font) -->
<w:p>
  <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
  <w:r><w:rPr><w:rStyle w:val="LeadIn"/></w:rPr><w:t>Emphasis</w:t></w:r>
</w:p>
```

```js
// docx-js: same defect -- LeadIn is a bold character style, Heading2 a bold paragraph style
new Paragraph({ style: "Heading2", children: [new TextRun({ text: "Emphasis", style: "LeadIn" })] });
```

## RIGHT
```xml
<!-- Option 1: bold lives in exactly ONE layer. Runs inside a bold paragraph style carry no bold style. -->
<w:p>
  <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
  <w:r><w:t>Bold from the paragraph style only</w:t></w:r>
</w:p>

<!-- Option 2: explicit direct formatting on the run. Direct w:b is absolute, not toggled. -->
<w:r>
  <w:rPr><w:b w:val="1"/></w:rPr>
  <w:t>Always bold</w:t>
</w:r>
```

```js
// docx-js: put direct bold on the run (emits <w:b/> in the run's rPr), so the result
// no longer depends on which styles it sits inside.
new TextRun({ text: "Emphasis", bold: true });
// If you keep a character style for colour/font, still add direct bold:
new TextRun({ text: "Emphasis", style: "LeadIn", bold: true });
```

## NOTES
- The toggle rule applies to values that come from styles (paragraph style, character style, table style). Direct run formatting is applied as-is, which is why Option 2 is robust.
- Verify by rendering through Word itself and looking at the page (e.g. Word COM to XPS, then rasterize). Asserting properties in the generated XML proves nothing here, because every layer really does say bold.
- The same trap hits italic: an italic character style inside an italic paragraph style (a quote, a caption) renders upright.
