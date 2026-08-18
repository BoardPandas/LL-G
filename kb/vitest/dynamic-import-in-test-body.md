---
tech: vitest
tags: [vitest, dynamic-import, test-timeout, flaky-tests, vi-mock, vi-hoisted, vite-transform, ci]
severity: high
---
# A dynamic import inside a test body is billed to that test's timeout

## PROBLEM

`const { thing } = await import("./thing")` inside an `it()` body charges Vite's
one-time resolve + transform of that module's whole graph to **that test's own
per-test timeout**. A test doing a millisecond of work can therefore fail with
`Test timed out in 5000ms` under full-suite parallel load, while passing in ~1s
when run alone.

This is not a slow test. In a real 646-file suite the summary line read:

```
Duration 39.03s (transform 308.31s, setup 30.55s, import 919.47s, tests 35.62s)
```

Aggregate import time was **26x** the time spent running test bodies. Every
worker competes for the same transform pipeline, so adding unrelated test files
to the repo can tip a previously-green file over the 5s default.

The failure is maximally misleading:

- **It is intermittent and random.** A run reports 1-5 failures in different
  files each time, which trains everyone to re-run rather than read the failure.
  That is precisely the state in which a genuine regression gets waved through.
- **It lands on tests that cannot fail.** The case that exposed this asserted on
  a pure string-building function with no I/O, no clock, and no randomness --
  something that literally cannot fail an assertion. A timeout was the only
  possible explanation, which is what made it diagnosable.
- **It cascades.** A timed-out test keeps executing after vitest has moved on, so
  its calls land on the *next* test's spies and turn one timeout into several
  unrelated-looking failures (`expect(spy).not.toHaveBeenCalled()` fails in a
  test that never ran the code).

Raising `testTimeout` hides it. It also hands a fully-mocked unit test a 30-second
window in which a real hang goes unnoticed -- the fix is to stop paying the cost
inside the test at all.

## WRONG

```ts
vi.mock("@/lib/db", () => ({ db: mockDb }));

describe("getThing", () => {
  it("returns the thing", async () => {
    // Charges the whole transitive graph's transform to this test's 5s budget.
    const { getThing } = await import("./thing");
    expect(getThing()).toBe("thing");
  });
});
```

## RIGHT

```ts
// vi.mock is hoisted ABOVE imports, so a static import is still mocked -- and the
// graph is evaluated during file collection, where no per-test timeout applies.
import { getThing } from "./thing";

// Anything a vi.mock factory closes over must move into vi.hoisted(): the
// factories hoist above every import, so a plain `const` further down the file is
// still in its TDZ when the factory runs.
const { mockDb } = vi.hoisted(() => ({ mockDb: { select: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: mockDb }));

// Reset spies in a FILE-level beforeEach, not a per-suite copy, so a failing case
// cannot leave a spy dirty for the next one.
beforeEach(() => {
  mockDb.select.mockClear();
});

describe("getThing", () => {
  it("returns the thing", () => {
    expect(getThing()).toBe("thing");
  });
});
```

## NOTES

**Audit before you sweep -- most `await import()` in test files is fine.** Of 18
call sites in one repo, only 8 were charged to a timeout:

- **Module-scope top-level await** (`const { x } = await import("./x")` at file
  scope) runs during collection. Not affected.
- **Inside a `vi.mock(path, async () => ...)` factory** runs at module
  registration. Not affected -- and this is the sanctioned idiom for partial mocks.
- **Inside an `it`/`test`/`beforeEach` body** is the only shape that matters.

Rewriting the first two is pure churn on files that were already correct.

**Keep the dynamic import where the lateness is load-bearing**, and say why in a
comment or someone will "tidy" it back into a bug:

- **After `vi.resetModules()`, when the module has module-level state.** Verify
  this rather than assuming it. In one case a module memoized derived crypto keys
  in a module-scope `Map`; with a warm cache, a token encrypted after the master
  key env var changed could not be decrypted by a fresh instance -- proving the
  cached key was still the old one. A static binding there would have left the
  test round-tripping green *without ever exercising the new key*: it still
  passes, it just stops testing anything.
- **To defer an expensive or environment-dependent module past a
  `describe.skipIf(...)`.** A top-level `import "@/lib/db"` is evaluated during
  collection **even when every case in the file skips**, building a real database
  client on exactly the machines the skip exists to protect.

Note that re-importing after `vi.resetModules()` re-*evaluates* but does not
re-*transform* -- the transform cache is keyed on file content -- so a static
import elsewhere in the file already paid the expensive part.

**These flakes do not reproduce on an idle machine.** A 32-core box ran the suite
green 6 times out of 6 on a genuinely broken file; "could not reproduce" is the
default wrong conclusion. Force contention:

```bash
pids=()
for _ in $(seq 64); do bash -c 'while :; do :; done' & pids+=($!); done
trap 'kill "${pids[@]}" 2>/dev/null' EXIT
npx vitest run          # the flake now surfaces
```

Measure before *and* after with the same hog count -- a green run at normal load
proves nothing about a fix.

Set a modest `testTimeout` in the config as a net for the sites that must stay
dynamic, not as the fix for the ones that don't.
