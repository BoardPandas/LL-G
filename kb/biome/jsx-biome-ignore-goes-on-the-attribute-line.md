---
tech: biome
tags: [biome, lint, jsx, suppression]
severity: low
---
# Biome: an attribute-level suppression in JSX must sit on the attribute's line

## PROBLEM
Biome attaches the diagnostic to the attribute node, so a suppression comment above the element is reported as unused and the original error stays.

## WRONG
```tsx
{/* biome-ignore lint/a11y/noNoninteractiveTabindex: composite widget */}
<svg tabIndex={0} role="application" />
```

## RIGHT
```tsx
<svg
  // biome-ignore lint/a11y/noNoninteractiveTabindex: composite widget
  tabIndex={0}
  role="application"
/>
```
