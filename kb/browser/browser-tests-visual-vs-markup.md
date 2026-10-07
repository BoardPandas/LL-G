---
tech: browser
tags: [testing, race-condition, loading-state, stylesheet-loading, lazy-loading, computed-layout]
severity: high
---
# Browser tests miss rendering-order and lazy-stylesheet bugs

## PROBLEM
DOM structure tests pass on unstyled markup. A tab's stylesheet loads only when first activated; tests that never activate that tab never load the sheet. Rendered measurements (width, wrapping) return 0 if layout hasn't computed. Tests coupling assertions to module source locations fail when refactored.

## WRONG
```typescript
test('tab renders', () => {
  const note = document.querySelector('.note');
  expect(note).toBeTruthy();  // Passes even if CSS missing
});

test('button fits', () => {
  const w = document.querySelector('button').offsetWidth;
  expect(w).toBeLessThan(100);  // Returns 0 if not visible
});

test('state', () => {
  const state = require('./add-card-state.js').getInitialState();
  // Fails if file moves
});
```

## RIGHT
```typescript
test('tab renders', async () => {
  await page.click('[aria-label="Source"]');
  
  await page.waitForFunction(() => {
    const note = document.querySelector('.note');
    return note && window.getComputedStyle(note).marginTop !== '0px';
  });
  
  const margin = await page.$eval('.note', 
    el => window.getComputedStyle(el).margin);
  expect(margin).not.toBe('0px');
});

test('button fits', async () => {
  await page.evaluate(() => {
    document.querySelector('button').scrollIntoView();
    return document.querySelector('button').offsetWidth;
  });
  expect(btnWidth).toBeLessThan(100);
});

test('state', () => {
  const { getInitialState } = require('./add-card-state.js');
  expect(getInitialState().selectedCards).toEqual([]);
});
```

## NOTES
Loading content passes structural checks. Test loaded state by asserting content that cannot exist while loading (specific text, real data). If stylesheets are lazy-loaded, tests must activate the feature that loads them. Use a real browser harness (Playwright) for rendered measurements and computed style.
