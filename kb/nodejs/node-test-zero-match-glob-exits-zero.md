---
tech: nodejs
tags: [nodejs, node-test, test-runner, glob, vacuous-pass, ci, guards]
severity: high
---
# `node --test` with a glob that matches nothing exits 0, so a moved or mistyped test path passes green

## PROBLEM
`node --test "scripts/**/*.test.mjs"` (quoted, so Node expands the glob itself) reports
`ℹ tests 0` and **exits 0** when the pattern matches no files. Verified on Node 24.21.0.

A test script built on this is a gate that can silently stop testing:
- Rename a directory, move the tests, or typo the glob, and CI stays green with zero tests run.
- The output reads like a normal run (`ℹ pass 0`, `ℹ fail 0`), and green runs are rarely read.
- It is worst for guard self-tests ("verify the ruler before you measure"): the step meant to
  prove the guards still fire proves nothing and says so with a green check.

Contrast: a literal non-glob path that does not exist fails loudly. Only the glob form is
silent.

## WRONG
```json
{
  "scripts": {
    "test:guards": "node --test \"scripts/**/*.test.mjs\""
  }
}
```
```bash
node --test "nonexistent/**/*.test.mjs"; echo "exit=$?"   # ℹ tests 0 ... exit=0
```

## RIGHT
Resolve the files yourself, assert a floor, then hand them to the runner:
```js
// scripts/run-guard-tests.mjs
import { globSync } from "node:fs";
import { spawnSync } from "node:child_process";

const MIN = 5; // raise as guard tests are added; never lower it to get green
const files = globSync("scripts/**/*.test.mjs");
if (files.length < MIN) {
  console.error(`test:guards: found ${files.length} test files, expected at least ${MIN}.`);
  process.exitCode = 1;
} else {
  const r = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
}
```
```json
{ "scripts": { "test:guards": "node scripts/run-guard-tests.mjs" } }
```
Pass the files as an argv array, never through a shell string (see
execsync-shell-expands-child-glob).

## NOTES
- A test that asserts the expected test files exist also works, but it is itself discovered
  by the same glob, so it vanishes along with everything else. The floor belongs outside the
  glob.
- Applies to any runner invoked with a glob. Check its zero-match exit code once, deliberately.
