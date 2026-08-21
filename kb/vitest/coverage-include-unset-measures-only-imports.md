---
tech: vitest
tags: [vitest, coverage, v8, thresholds, include, ci, silent-failure, metrics]
severity: high
---
# Coverage without an explicit `include` measures only the files your tests import, and rises when you delete one

## PROBLEM

`coverage.include` defaults to *files loaded during the test run*, not your source tree.
Set only `coverage.exclude` and you get a percentage computed over the subset of modules
your tests happen to `import`. Every file no test reaches is absent from the numerator
**and the denominator**, so it does not drag the number down -- it simply is not counted.

Two consequences, both bad, and the second is what makes this dangerous rather than
merely wrong:

1. **The number describes the tested subset, not the codebase.** A real project reported
   `Statements: 83.99%` over 2,411 statements. With `include: ['src/**/*.{ts,tsx}']` added
   and nothing else changed, the same suite reported `27.70%` over 7,012. The first number
   covered 91 of 284 source files. Nobody had lied; the config had just never been asked
   the right question.
2. **The metric moves the wrong way.** Delete a module from the import graph, or drop the
   last test that touched it, and coverage **goes up**, because you removed uncovered
   lines from the denominator. A team ratcheting a threshold upward can be rewarded for
   deleting tests.

This is the "gate that reads nothing" shape: it runs, it prints a confident figure, it
never fails, and nobody re-examines it because the number looks fine. It is worse than no
coverage reporting, which at least does not manufacture confidence.

Related trap in the same config: with no `thresholds` block, `vitest run --coverage`
**cannot fail**. It is a report, not a gate. And if `--coverage` is not in the command CI
actually runs (a `test:run` script that omits it), nothing enforces it at all.

## WRONG

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Only exclusions. `include` is unset, so the denominator is
      // "whatever the tests imported" -- which is not a knowable number
      // and shrinks as the import graph shrinks.
      exclude: [
        'node_modules/',
        '**/*.test.{ts,tsx}',
      ],
      // No thresholds => the run cannot fail. This is a report, not a gate.
    },
  },
});
```

```jsonc
// package.json -- and CI runs the script WITHOUT coverage, so even the report is unseen
"test:run":      "vitest run",
"test:coverage": "vitest run --coverage"   // exists, but nothing calls it
```

## RIGHT

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],

      // Put every source file in the denominator whether a test reaches it or not.
      // This is the whole fix.
      include: ['src/**/*.{ts,tsx}'],

      exclude: [
        'node_modules/',
        '**/*.test.{ts,tsx}',
        'src/generated/**',   // generated output is not your risk surface
        'src/types/**',       // type-only modules compile to nothing: v8 reports 0/0
      ],

      // Measure the real number FIRST, then pin thresholds just under it, so the
      // gate bites on regression today instead of "once we get around to it".
      // Ratchet upward as coverage improves. Never lower them to make CI green.
      thresholds: { statements: 27, branches: 21, functions: 16, lines: 27 },
    },
  },
});
```

```yaml
# CI must run the command that carries --coverage, or the thresholds are decorative.
- name: Test + coverage thresholds
  run: npm run test:coverage
```

Verify the gate actually bites before trusting it:

```bash
# Should exit 1. If it exits 0, thresholds are not wired.
npx vitest run --coverage --coverage.thresholds.lines=90; echo "exit=$?"
```

## NOTES

**How to detect this in an existing repo without changing anything:** count the files in
the coverage report and compare against the source tree. A large gap is the tell.

```bash
npx vitest run --coverage --coverage.reporter=json-summary
node -e "
  const j=require('./coverage/coverage-summary.json');
  console.log('in report:', Object.keys(j).filter(k=>k!=='total').length);
" 
git ls-files 'src/**' | grep -E '\.(ts|tsx)$' | grep -vE '\.(test|spec)\.' | wc -l
```

**Expect the honest number to be shocking**, and do not treat that as a reason to back
out. Going from a reported 85% to a real 28% is not a regression, it is the first
accurate reading. Pin the threshold at the true value immediately -- a low threshold that
is enforced beats a high one that is fictional.

**`all: true` is not the fix on modern Vitest.** It was the Vitest 1.x mechanism and is
deprecated/removed in favour of `include`. Setting `all` on v3+ does not restore the
behaviour; reach for `include`.

**Applies to the v8 provider specifically**, and to any coverage setup that instruments
at require/import time rather than walking the source tree: Istanbul via Vite, c8, and
`jest --coverage` without `collectCoverageFrom` have the same shape. The question to ask
of any coverage config is "what is in the denominator?", and if the answer is "whatever
got imported", the number is not measuring what its name implies.
