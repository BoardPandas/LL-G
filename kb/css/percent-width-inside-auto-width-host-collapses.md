---
tech: css
tags: [custom-element, percentage-width, flex, wrapper]
severity: medium
---
# A percentage width on a control inside an auto-width wrapper collapses the control

## PROBLEM
A select carried `max-width: 48%`, written when it was a direct flex child. A later change wrapped every select in a custom element (`display: block; width: auto`). The percentage then resolved against a host that is itself sized by the select, and the select rendered about 59px wide, showing "Pi" for "Pick one...". Markup tests pass; only a rendered measurement shows it.

## WRONG
```css
.row-select { flex-shrink: 0; max-width: 48%; }
```

## RIGHT
```css
.row > my-select-host { flex: 1 1 13rem; }  /* the host takes the share */
.row-select { width: 100%; }                /* the control fills it */
```

## NOTES
After wrapping a native control, re-check every percentage width and flex rule that targeted the control's class. Guard it with a real-engine assertion on rendered width.
