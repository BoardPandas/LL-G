---
tech: browser
tags: [browser-testing, stylesheet-loading, lazy-loading, visual-regression, dom-vs-render]
severity: high
---
# Browser tests miss rendering-order and lazy-stylesheet bugs

## PROBLEM
A DOM structure test passes on markup that is unstyled when first rendered. A tab's stylesheet is fetched only when that tab is first activated, so if a test always opens on tab A, the markup test never sees tab B's actual styling. Visual assertions pass because the DOM is correct, but the rendered tab looks wrong. A visual harness that uses headless Chromium can catch this; markup tests cannot. Additionally, a test that reads a rendered measurement off an element can get the wrong value if the layout has not yet computed (element not visible, stylesheet not loaded), and text-wrapping assertions that just read the DOM cannot see how words actually break.

## WRONG
```typescript
// Markup-only test
test('Source tab renders', () => {
  const sourceTab = document.querySelector('.source-tab');
  const note = sourceTab.querySelector('.dk-ps-note');
  
  expect(note).toBeTruthy(); // Passes even if CSS is missing
  expect(note).toHaveClass('dk-ps-note'); // Passes for any markup
  
  // Cannot assert computed style, layout, or color
});

// Rendered measurement without layout guarantee
test('button fits in container', async () => {
  const btn = document.querySelector('button');
  const container = document.querySelector('.container');
  
  // May return 0 if button is not visible yet
  const btnWidth = btn.offsetWidth;
  const containerWidth = container.offsetWidth;
  
  expect(btnWidth).toBeLessThan(containerWidth);
});

// No test for lazy-loaded sheets
// "The upload key wraps" was assumed from DOM flex-wrap
// but .tcg-btn has white-space: nowrap, so it doesn't
```

## RIGHT
```typescript
// Visual harness with real browser rendering
test('Source tab renders correctly', async () => {
  const page = await browser.newPage();
  await page.goto('/deck');
  
  // Click to activate the Source tab
  await page.click('[aria-label="Source"]');
  
  // Wait for stylesheet to load
  await page.waitForFunction(() => {
    const note = document.querySelector('.dk-ps-note');
    if (!note) return false;
    const style = window.getComputedStyle(note);
    return style.marginTop !== '0px'; // Stylesheet applied
  });
  
  // Now assert computed values
  const margin = await page.$eval('.dk-ps-note', 
    (el) => window.getComputedStyle(el).margin);
  expect(margin).not.toBe('0px');
  
  // Screenshot for visual regression
  await page.screenshot({ path: 'source-tab.png' });
});

// Measure after layout
test('button fits in container', async () => {
  const page = await browser.newPage();
  await page.goto('/page');
  
  // Ensure button is visible
  await page.waitForSelector('button');
  
  // Measure after layout has computed
  const [btnWidth, containerWidth] = await page.evaluate(() => {
    const btn = document.querySelector('button')!;
    const container = document.querySelector('.container')!;
    
    // Force layout computation
    btn.scrollIntoView();
    container.scrollIntoView();
    
    return [btn.offsetWidth, container.offsetWidth];
  });
  
  expect(btnWidth).toBeLessThan(containerWidth);
});

// Test real text wrapping with visual harness
test('upload key wrapping', async () => {
  const page = await browser.newPage();
  const viewport = { width: 320, height: 600 }; // Mobile
  await page.setViewport(viewport);
  await page.goto('/upload');
  
  await page.waitForSelector('[data-test="upload-key"]');
  
  // Measure actual rendered text layout
  const wraps = await page.evaluate(() => {
    const el = document.querySelector('[data-test="upload-key"]') as HTMLElement;
    return el.clientHeight > 25; // Typical line height
  });
  
  expect(wraps).toBe(true); // Or false, based on expected design
});

// Markup test for structure, visual test for rendering
test('note element exists', () => {
  const note = document.querySelector('.dk-ps-note');
  expect(note).toBeTruthy();
  expect(note).toHaveClass('dk-ps-note');
});
```

## NOTES
Markup tests and visual tests measure different things. A DOM structure test validates "is the element present", while a visual test validates "does it render correctly given the full browser environment". Neither replaces the other. Browser harnesses like Playwright can run stylesheets, wait for dynamic loads, and measure computed style / actual layout—markup tests run on the raw DOM.

If a stylesheet is lazy-loaded (fetched when a feature activates), a test that never activates that feature never loads the sheet. Activate all features in your test, or structure stylesheets as page-global, not tab-local.

Rendered text wrapping, icon sizing, and computed colors require a real browser. A headless visual harness (`scripts/visual/` in many repos) can automate this without the Chrome extension dependency.
