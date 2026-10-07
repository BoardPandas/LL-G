---
tech: browser
tags: [testing, race-condition, loading-state, fixture-mismatch, content-readiness]
severity: high
---
# Browser tests miss rendering-order and lazy-stylesheet bugs

## PROBLEM
Browser audit checks that run before content is populated capture loading placeholders instead of actual UI. An early fixture parses the CLI status with an escaped-digit regex, treating any API reply as an error; another check accepted a non-empty Loading placeholder as ready. Both tests pass when they should fail because they're measuring the wrong thing: the loading state, not the actual page. A test harness that ignores Escape when its overlay root is inert receives those events in covered layers, so the overlay dismisses when it shouldn't. Finally, a test that couples assertions to the source location of a module fails when that module is refactored.

## WRONG
```typescript
// Test checks for ANY non-empty content
test('page loads', async () => {
  const page = await browser.goto('/');
  const content = await page.$('.content');
  expect(content).toBeTruthy(); // Passes for Loading... too
});

// Regex check treats any API response as an error
const statusRegex = /error: (\d)/;
const status = response.text;
if (statusRegex.test(status)) {
  throw new Error('API failed');
}

// Overlay root capture handler doesn't distinguish covered layers
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlayRoot.inert) {
    dismiss(); // Escapes in covered layers also trigger this
  }
});

// Test couples assertion to module location
test('initial state', () => {
  const state = require('./add-card-state.js').getInitialState();
  expect(state.selectedCards).toEqual([]);
});
```

## RIGHT
```typescript
// Test waits for populated content AND API to be idle
test('page loads', async () => {
  const page = await browser.goto('/');
  
  // Wait for actual content, not just presence of an element
  await page.waitForFunction(() => {
    const content = document.querySelector('.content');
    // Not loading state, has real text/elements
    return content && !content.textContent?.includes('Loading');
  }, { timeout: 5000 });
  
  // Verify API is idle
  const pendingRequests = await page.evaluate(() => window.pendingRequests);
  expect(pendingRequests).toBe(0);
});

// Parse status more robustly
const lines = response.text.trim().split('\n');
const jsonLine = lines.slice(0, -1).join('\n'); // Skip final HTTP status line
const status = JSON.parse(jsonLine);
if (status.error) {
  throw new Error(`API error: ${status.error}`);
}

// Overlay dismisses only in its own capture phase
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlayRoot === e.currentTarget) {
    dismiss();
  }
}, true); // Capture phase

// Test the exported state factory without coupling to file location
test('initial state', () => {
  const { getInitialState } = require('./add-card-state.js');
  const state = getInitialState();
  expect(state.selectedCards).toEqual([]);
});
```

## NOTES
Loading content passes many structural checks because it has the same DOM shape as the real content. Test loaded state by asserting content that CANNOT exist while loading (specific text, real data), not just element presence. Browser harnesses that pretend to be real clients need to handle all events a real browser sends. Escape events in particular bubble and capture through every layer; handlers must check the target or use `event.stopPropagation()` to prevent covered elements from intercepting.

Moving modules invalidates source-location assertions—test the exported interface instead, and mock dependencies that the test needs to isolate (like the browser preference bridge).
