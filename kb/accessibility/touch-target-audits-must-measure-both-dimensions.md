---
tech: accessibility
tags: [touch-targets, browser-testing, getboundingclientrect, responsive, ui-scale]
severity: high
---
# Touch-target audits must measure both dimensions

## PROBLEM
A touch-target audit that checks only height can report a clean 44 px floor while narrow icon
buttons remain 26-35 px wide. Static CSS review misses the same defect when a shared height token is
present but width still comes from the glyph, padding, or an auto-sized wrapper. The result is a
confident accessibility pass on controls that are still difficult to hit.

## WRONG
```js
const failures = controls.filter((control) => {
  const rect = control.getBoundingClientRect();
  return rect.height < 44;
});
```

## RIGHT
```js
const failures = controls.flatMap((control) => {
  const rect = control.getBoundingClientRect();
  return rect.width < 44 || rect.height < 44
    ? [{ control, width: rect.width, height: rect.height }]
    : [];
});
```

## NOTES
Run the measurement in a real browser under the intended coarse-pointer viewport, device pixel
ratio and application scale. Audit every visible interactive/focusable control, report both
dimensions, and retain any intentional fine-pointer density exception as a separate contract.
