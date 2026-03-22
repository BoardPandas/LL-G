---
tech: css
tags: [iframe, font-face, woff2, blob-url, srcdoc, google-fonts, self-hosted]
severity: high
---
# Self-hosted @font-face fonts do not render inside iframe documents

## PROBLEM
When rendering content inside iframes (srcdoc, blob URL, or document.write), self-hosted WOFF2 fonts loaded via `@font-face` declarations do not render -- the browser falls back to generic family fonts (Georgia, system-ui, etc.) even though:
- The WOFF2 files are valid (correct magic bytes, correct file size)
- The browser fetches them successfully (200/304 in Network tab)
- The `@font-face` CSS is syntactically correct
- The CSS custom properties referencing the fonts resolve correctly

This was confirmed across 15 separate attempts using every known approach: relative URLs, absolute URLs, `<base href>`, blob URLs for iframe documents, blob URLs for font files, base64 data URIs embedded in CSS, and build-time bundled base64 modules. All failed identically in both Chrome and Vivaldi.

The only working approach is Google Fonts CDN `<link>` tags in the iframe's `<head>`.

## WRONG
```css
/* Any of these inside an iframe document -- none render the named font */

/* Approach 1: URL reference */
@font-face {
  font-family: 'Playfair Display';
  src: url('/fonts/playfair-display/playfair-display-400.woff2') format('woff2');
  font-weight: 400;
}

/* Approach 2: Absolute URL */
@font-face {
  font-family: 'Playfair Display';
  src: url('https://example.com/fonts/playfair-display-400.woff2') format('woff2');
  font-weight: 400;
}

/* Approach 3: Base64 data URI */
@font-face {
  font-family: 'Playfair Display';
  src: url(data:font/woff2;base64,d09GMgABA...) format('woff2');
  font-weight: 400;
}
```

## RIGHT
```html
<!-- Use Google Fonts <link> tags in the iframe's <head> -->
<head>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&display=swap" rel="stylesheet" />
  <style>
    :root { --font-heading: 'Playfair Display', Georgia, serif; }
  </style>
</head>
```

## NOTES
- The font category (serif/sans-serif/monospace) DOES change correctly when selecting different fonts, proving the CSS variable pipeline works. It's specifically the named font that doesn't render.
- This applies to any iframe isolation pattern (design systems, email previews, sandboxed content).
- Google Fonts CDN works because the browser handles the `<link>` tag's font loading natively, outside the iframe's document context restrictions.
- If Google Fonts is not acceptable (privacy, offline), investigate using the CSS Font Loading API (`document.fonts.add()`) inside the iframe's script context as a potential alternative.
- Discovered during BoardPandas Design Studio development, confirmed across 15 attempts over 2 days.
