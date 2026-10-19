---
tech: nodejs
tags: [node-test, test-runner, node-test-context, nested, spawnsync, vacuous-pass, exit-code]
severity: high
---
# A nested `node --test` inherits NODE_TEST_CONTEXT and exits 0 without running

## PROBLEM
A `node --test` started from inside a test that `node --test` is running inherits `NODE_TEST_CONTEXT`, skips every file it was given, and exits 0, even when those files fail. Its stdout is empty, and its only trace is one warning on stderr. It takes itself for a child of the outer run (the variable is `child-v8` on Node 24) and declines to start a run of its own.

This bites anything tested under `node --test` that starts its own run: a guard-test or coverage wrapper, a CI script's self-test, a fixture suite run from a test. A test asserting that the inner run passed passes whatever the inner tests do. A test asserting that it failed fails, with no report to say why.

## WRONG
```js
// scripts/run-tests.mjs: a wrapper that starts node --test itself
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exitCode = r.status ?? 1;
```
```js
// scripts/run-tests.test.mjs, itself run by `node --test`
test("the wrapper passes a green suite", () => {
  const r = spawnSync(process.execPath, ["scripts/run-tests.mjs"], { cwd: fixtureDir, encoding: "utf8" });
  assert.equal(r.status, 0); // passes, and would for a red suite too: nothing ran
});
```

## RIGHT
In anything that starts its own `node --test`, drop the variable for the child:
```js
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit", env });
```
Do the same in a test that spawns a runner directly. Assert on the child's own summary lines (`ℹ tests 1`, `ℹ fail 1`), which a skipped run never prints. Pair every "it passes" case with an "it fails" case, so a run that did nothing cannot satisfy both.

## NOTES
- Reproduced on Node 24.22.0. The nested run of a file whose only test throws gave status 0 and empty stdout. Its stderr held `Warning: node:test run() is being called recursively within a test file. skipping running files.` With `NODE_TEST_CONTEXT` removed, the same command printed its report and exited 1.
- `spawnSync` with the default `stdio: "pipe"` keeps that warning in `r.stderr`, where nothing reads it.
- Deleting the variable is safe in an outermost runner, which is never meant to report to a parent run.
- `nodejs/node-test-zero-match-glob-exits-zero` is the other way a `node --test` run exits 0 having run nothing.
