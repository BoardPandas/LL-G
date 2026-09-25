---
tech: css
tags: [accessibility, reduced-motion, transitions, component-reuse, browser-testing]
severity: high
---
# Reused components are not automatically covered by reduced-motion rules

## PROBLEM
A feature can correctly reuse an established animated component while still shipping a reduced-motion violation. Existing `prefers-reduced-motion` blocks often enumerate only the selectors known when they were written; they do not automatically cover every component in the stylesheet. Typecheck, lint, unit tests, and a visual review at the default motion preference all stay green, so source-level reuse looks like accessibility reuse even though the browser still computes a non-zero transition.

## WRONG
```css
.toast {
  transition: opacity 150ms, transform 150ms;
}

@media (prefers-reduced-motion: reduce) {
  .spinner,
  .fresh-arrival {
    animation-duration: 0.01ms;
  }
}
```

```js
// Reusing .toast is assumed to inherit the app's reduced-motion policy.
showToast("Update available");
```

## RIGHT
```css
@media (prefers-reduced-motion: reduce) {
  .toast {
    transition: none;
  }

  .spinner,
  .fresh-arrival {
    animation-duration: 0.01ms;
  }
}
```

Verify the real computed result in a browser rather than inferring it from the presence of a media block:

```js
await page.emulateMedia({ reducedMotion: "reduce" });
const duration = await page.locator(".toast").evaluate(
  (element) => getComputedStyle(element).transitionDuration,
);
expect(duration).toBe("0s");
```

## NOTES
This applies to animations as well as transitions. Reusing a design-system component reduces visual drift, but reduced-motion coverage remains selector-specific and must be measured on the rendered component.
