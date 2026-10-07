---
tech: vitest
tags: [test-isolation, module-loading, global-state, fixture-compatibility]
severity: high
---
# Moving dynamic imports from test bodies to module scope reveals hidden dependencies

## PROBLEM
Hoisting `await import()` breaks if a product module reads global state as it loads. A module checking for `window` loads before the test's fake `window` and reads wrong environment. Parity tests stay green if both implementations fail identically.

## WRONG
```typescript
beforeEach(async () => {
  const lib = await import('../src/lib.js');  // Fakes applied each time
});

// Optimization: hoist to module scope
const lib = await import('../src/lib.js');  // Runs BEFORE fakes

describe('lib', () => {
  it('works', () => {
    // lib initialized without fakes
  });
});

test('both agree', () => {
  expect(newImpl(DATA)).toEqual(oldImpl(DATA));  // Both return null
});
```

## RIGHT
```typescript
beforeAll(() => {
  global.window = { /* fake */ };
});

// NOW safe to import
const lib = await import('../src/lib.js');

describe('lib', () => {
  it('works', () => {
    // lib initialized WITH fakes
  });
});

test('both agree', () => {
  expect(newImpl(DATA) || oldImpl(DATA)).toBeTruthy();  // One must be non-null
  expect(newImpl(DATA)).toEqual(oldImpl(DATA));
});
```

## NOTES
Audit every product module for reads of globals as it loads (`process.env`, `window`, `process.cwd()`, `Date.now()`). Keep setup code in `beforeAll` before any module-scope imports. Parity tests need an assertion that at least one side returns non-null data.
