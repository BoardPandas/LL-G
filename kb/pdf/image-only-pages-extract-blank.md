---
tech: pdf
tags: [pdftotext, poppler, pymupdf, image-only, scanned, text-extraction, silent-failure]
severity: high
---
# pdftotext silently returns blank text for image-only pages

## PROBLEM
`pdftotext` writes no warning when a page has no text layer. A scanned page, or a page
stored as an image, comes out as an empty string, and the command still exits 0. A reader
of the extracted text sees a blank where a section should be. It can pass for an absent
section rather than an unreadable one. Found reviewing vendor audit reports: the auditor's
opinion section came back empty, and the review had to read it from rendered page images.

## WRONG
```bash
pdftotext -layout report.pdf report.txt
# report.txt is treated as the whole document
```

## RIGHT
```python
import pymupdf  # PyMuPDF; the older alias `fitz` still works but warns

doc = pymupdf.open(path)
for number, page in enumerate(doc, start=1):
    if len(page.get_text().strip()) < 50:  # heuristic: a short page may be a real divider
        page.get_pixmap(dpi=90).save(f"page-{number}.png")  # read the image, not the text
```
Count characters per page before trusting extracted text. A short page can be a real divider,
so check the rendered image rather than assuming the page is missing.

## NOTES
`pdftotext` separates pages with form-feed characters, so per-page counts can also be taken
from its output by splitting on `\f`. Rendering needs no extra system package when PyMuPDF is
installed.
