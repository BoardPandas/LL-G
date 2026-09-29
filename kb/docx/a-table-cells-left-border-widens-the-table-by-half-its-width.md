---
tech: docx
tags: [docx, ooxml, tables, borders]
severity: medium
---
# A table cell's left border widens the table by half its width

## PROBLEM
A common callout component is a one-cell table exactly as wide as the text column, with a thick coloured rule on the cell's left edge. Word does not draw that border inside the declared width: the table ends up **half the border width wider** than `tblW`, so it overhangs the right margin. With a 4.5 pt rule (`w:sz="36"`, eighths of a point) the overhang is 2.25 pt (45 twips). It is small enough to miss in the XML and in a quick glance, but it shows as a ragged right edge against the body text and can push the table past the printable area.

A second layout rule in the same family: a table **row takes the largest top cell margin of any cell in it**. Give one cell extra top padding and every cell in the row moves down with it, so text in the neighbouring cells no longer lines up with where you placed it.

## WRONG
```xml
<!-- 6.5 in text column = 9360 twips; table declared exactly that wide -->
<w:tbl>
  <w:tblPr><w:tblW w:w="9360" w:type="dxa"/></w:tblPr>
  <w:tblGrid><w:gridCol w:w="9360"/></w:tblGrid>
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="9360" w:type="dxa"/>
        <w:tcBorders><w:left w:val="single" w:sz="36" w:color="1F9BD7"/></w:tcBorders> <!-- 4.5 pt rule -->
      </w:tcPr>
      <w:p><w:r><w:t>Callout text</w:t></w:r></w:p>
    </w:tc>
  </w:tr>
</w:tbl>
<!-- Renders 45 twips past the right margin. -->

<!-- Row with mixed top margins: the whole row inherits the 200-twip top margin. -->
<w:tc><w:tcPr><w:tcMar><w:top w:w="200" w:type="dxa"/></w:tcMar></w:tcPr>...</w:tc>
<w:tc><w:tcPr><w:tcMar><w:top w:w="60"  w:type="dxa"/></w:tcMar></w:tcPr>...</w:tc>
```

## RIGHT
```js
// docx-js: subtract half the rule from the table and cell width.
const ruleSz = 36;                                        // eighths of a point (4.5 pt)
const halfRuleDxa = Math.round(((ruleSz / 8) * 20) / 2);  // pt -> twips, halved = 45
const width = textWidthDxa - halfRuleDxa;                 // 9360 - 45 = 9315

new Table({
  width: { size: width, type: WidthType.DXA },
  columnWidths: [width],
  rows: [new TableRow({ children: [new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { left: { style: BorderStyle.SINGLE, size: ruleSz, color: "1F9BD7" } },
    // Same top margin on every cell in a row -- the row uses the largest one anyway.
    margins: { top: 200, bottom: 200, left: 260, right: 260 },
    children: [/* paragraphs */],
  })] })],
});
```

```xml
<!-- Equivalent raw OOXML: tblW, gridCol and tcW all 9315 for a 9360 text column with a sz=36 left rule.
     Set top margins once for the table (tblCellMar) rather than varying them per cell. -->
<w:tblPr>
  <w:tblW w:w="9315" w:type="dxa"/>
  <w:tblCellMar><w:top w:w="200" w:type="dxa"/><w:bottom w:w="200" w:type="dxa"/></w:tblCellMar>
</w:tblPr>
```

## NOTES
- Alternatively, compensate with the table indent (`tblInd`) together with `tblW`; whichever you use, the rendered right edge is what must land on the margin.
- Border `w:sz` is in eighths of a point; widths and margins (`dxa`) are in twentieths of a point. Convert explicitly, as above, rather than eyeballing.
- If a row genuinely needs one cell to sit lower, pad inside that cell (paragraph spacing-before) instead of raising its top cell margin.
- Verify by rendering through Word and looking at the page edge against body text; neither the XML nor docx-js reports the overhang.
- Related: `bold-is-a-toggle-a-bold-run-inside-a-bold-style-renders-regular.md` on this shelf.
