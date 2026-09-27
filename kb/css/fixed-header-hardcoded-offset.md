---
tech: css
tags: [css, position-fixed, position-sticky, header, flexbox, responsive-css, visual-regression]
severity: medium
---
# A `position: fixed` header over a hard-coded content offset hides content when the header grows

## PROBLEM
A fixed header leaves the page flow, so pages clear it with a guessed offset such as `padding-top: 3rem`. The header's real height comes from its content and changes with the viewport. In one app it was 61px on a desktop, 13px more than the 48px offset, and 95px on a 390px phone, where its buttons wrapped. The first sidebar link and the page title sat under it, completely hidden on the phone. Nothing errors, and at the width the offset was tuned for it looks nearly right.

## WRONG
```html
<div style="display: flex; min-height: 100vh;">
  <header class="app-header">...</header>  <!-- .app-header { position: fixed; top: 0; } -->
  <div style="display: flex; padding-top: 3rem;">...</div>
</div>
```

## RIGHT
```css
.app-header { position: sticky; top: 0; z-index: 10; }
.app-page { display: flex; flex-direction: column; min-height: 100vh; }
.app-page-body { display: flex; flex: 1; }
/* A page exactly one screen tall whose columns scroll inside it */
.app-page-viewport { height: 100vh; }
.app-page-viewport .app-page-body { min-height: 0; }
```

```html
<div class="app-page">
  <header class="app-header">...</header>
  <div class="app-page-body">...</div>
</div>
```

## NOTES
- A sticky header stays in the flow, so the body starts at its bottom edge at any height. Verified headlessly at 1280, 768, and 390px wide, with the header still pinned after scrolling.
- `position: sticky` stops sticking when an ancestor sets `overflow: hidden` or `auto`, so the page wrapper itself must not scroll.
- A `--header-height` token applied to both the header and the offset fixes a desktop header, not one whose content wraps.
