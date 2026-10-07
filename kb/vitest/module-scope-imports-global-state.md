---
tech: vitest
tags: [test-isolation, module-loading, global-state, fixture-compatibility]
severity: high
---
# Moving dynamic imports from test bodies to module scope reveals hidden dependencies

## PROBLEM
Hoisting `await import()` from inside tests to module scope to improve performance can silently break if a product module reads global state as it loads. A module that checks for `window` existence to detect its environment loads before the test's fake `window`, and reads the wrong environment. Additionally, a parity test that validates two implementations return the same result can stay green after one side changes signature if both sides return null for the old argument. A test's dependencies on fixture behavior (like a setUp that fakes global objects) cannot be moved with the import.

## WRONG
```typescript
// Originally: imports inside beforeEach, clean state each test
beforeEach(async () => {
  const manaLib = await import('../src/shared/mana-pips.js');
  // test code
});

// Performance optimization: hoist to module scope
const manaLib = await import('../src/shared/mana-pips.js');

describe('mana pips', () => {
  it('renders pips', () => {
    // But manaLib checked for window as it loaded,
    // BEFORE the test's fake window was installed,
    // so it initialized incorrectly
  });
});

// Parity test that stays green after a break
test('both implementations agree', () => {
  const newResult = productNew.transform(DATA);
  const oldResult = productOld.transform(DATA);
  expect(newResult).toEqual(oldResult); // Both return null, both pass
});
```

## RIGHT
```typescript
// Set up global state BEFORE any imports
beforeAll(() => {
  global.window = { /* fake window */ };
  global.document = { /* fake document */ };
});

// Now safe to import at module scope
const manaLib = await import('../src/shared/mana-pips.js');

describe('mana pips', () => {
  it('renders pips', () => {
    // manaLib initialized with correct global state
  });
});

// Parity test with an assertion that catches signature changes
test('both implementations agree', () => {
  const newResult = productNew.transform(DATA);
  const oldResult = productOld.transform(DATA);
  
  // Ensure at least one side returned non-null actual data
  expect(newResult || oldResult).toBeTruthy();
  // THEN compare
  expect(newResult).toEqual(oldResult);
});

// Use a probe/spy to validate module-load side effects
test('module initialization', async () => {
  const initial = { env: process.env.NODE_ENV, hasWindow: typeof window !== 'undefined' };
  // Import the product
  const product = await import('../src/product.js');
  const final = { env: process.env.NODE_ENV, hasWindow: typeof window !== 'undefined' };
  
  // Module did NOT re-read globals
  expect(initial).toEqual(final);
});
```

## NOTES
When moving `await import()` out of test bodies, audit every product module that loads for reads of global state (`process.env`, `window`, `document`, `process.cwd()`, `Date.now()`). Keep setup code (faked globals, mocked modules, spies) in `beforeAll` and run it BEFORE any module-scope imports. 

Parity tests that just compare outputs without asserting nullability pass vacuously when both sides fail identically. Require at least one side to produce non-null data before the comparison.

Moving a comment with an import moves only the last line of a `//` block comment. Preserve comments where they are and reference them by intent in test code instead.
