---
tech: salesforce
tags: [salesforce, lwc, lightning, template, whitespace]
severity: medium
---
# LWC templates drop the space at the end of a line before an element

## PROBLEM
The LWC template compiler cleans text nodes with JSX rules, not HTML rules. Whitespace that
ends a line is removed, so a word followed by a line break and then an element or component
renders glued to it: "untilNov 21". No compiler warning, no console error; it shows only on
screen.

## WRONG
```html
<p>
    Valid until
    <lightning-formatted-date-time value={expires}></lightning-formatted-date-time>.
</p>
<!-- compiles to the text " Valid until" -> "Valid untilNov 21, 2026" -->
```

## RIGHT
```html
<p>
    Valid until <lightning-formatted-date-time
        value={expires}></lightning-formatted-date-time>.
</p>
<!-- compiles to " Valid until " -> "Valid until Nov 21, 2026" -->
```

## NOTES
A space before a line break is kept only when the line ends inside the same text node, as in
"Works with <strong>": the line ends at the tag. Punctuation followed by a line break and an
`{expression}` keeps its space ("x,\n{label}" gives "x, label") because the break is inside
one text node. To check, compile the template with `@lwc/template-compiler` and look for the
string literal: `compile(src, 'x.html', {}).code`. Prettier's HTML formatter can reintroduce
the break.
