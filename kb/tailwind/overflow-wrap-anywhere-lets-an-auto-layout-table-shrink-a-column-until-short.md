---
tech: tailwind
tags: [css, tables, overflow-wrap, break-anywhere, break-words, min-content]
severity: medium
---
# overflow-wrap: anywhere lets an auto-layout table shrink a column until short words split mid-word

## PROBLEM
`overflow-wrap: anywhere` (Tailwind `wrap-anywhere`) lowers a table cell's min-content width to a single character, so an auto-layout table can squeeze that column until short words split mid-word ("nothin" / "g").
It looks like the right choice for untrusted, unbroken text such as file paths, and it renders fine until the table runs short of room. `overflow-wrap: break-word` wraps long strings the same way but leaves min-content at the longest word, so the column is sized by whole words.

## WRONG
```css
/* Every cell with agent-written text, including short paths and the word "nothing" */
td.agent-text { overflow-wrap: anywhere; }
```

## RIGHT
```css
td.agent-text { overflow-wrap: anywhere; }
/* Columns of paths: wrap long ones, but size the column by whole words */
td.agent-text.files { overflow-wrap: break-word; min-width: 8rem; }
```

## NOTES
Only matters with `table-layout: auto` (the default), where columns are sized from min-content. A path with no break opportunity under `break-word` can widen its column, so keep the table in a horizontally scrolling wrapper. In Tailwind, `wrap-anywhere` is the bad case and `wrap-break-word` (v4) or `break-words` is the fix. Related: tailwind/tablecell-nowrap-defeats-wrapping.
