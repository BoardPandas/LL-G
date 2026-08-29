---
tech: jest
tags: [esm, commonjs, dependencies, patch-release, sanitize-html, htmlparser2, transitive-dependency, node24]
severity: high
---
# A patch bump can swap a transitive to ESM-only, and only Jest notices

## PROBLEM

A **patch** release of a direct dependency can move one of *its* dependencies
onto an ESM-only major. Nothing in your manifest says so, the audit stays clean,
the app runs fine, and the only thing that breaks is Jest.

`sanitize-html` 2.17.5 -> 2.17.7 is the case that cost the time. Between those
two patch versions the only dependency change was:

    htmlparser2: ^10.1.0  ->  ^12.0.0

htmlparser2@10 is dual-format — its `exports` carries both an `import` and a
`require` condition. htmlparser2@12 publishes a single `default` condition and
`"type": "module"`: **ESM only, no CJS entry at all.**

Node 24 absorbs this silently, because `require(ESM)` is supported from Node
22.12 onward. So the API boots, the build compiles, `node -e "require('sanitize-html')"`
prints correct output, and production is genuinely unaffected. Jest is the one
consumer that cannot do it: its module registry loads CommonJS itself and does
not implement `require(ESM)`. Thirteen suites stopped running at once.

The reason this is a HIGH and not the MEDIUM that "a loud test failure" would
normally earn is that **the error names the wrong package and points at a
CommonJS line**:

    SyntaxError: Cannot use import statement outside a module
      at Object.<anonymous> (node_modules/.pnpm/sanitize-html@2.17.7/node_modules/sanitize-html/index.js:1:20)

`sanitize-html/index.js:1` is `const htmlparser = require('htmlparser2')` — an
unambiguously CommonJS line, in a package that is itself CommonJS. Read
literally the trace accuses a file that contains no `import` statement. The
actual ESM is two levels down, in a package you never named and did not bump.
Checking `sanitize-html`'s own `package.json` (`type` absent, `main: index.js`)
confirms it is CJS and sends you looking in the wrong direction.

## WRONG

```jsonc
// package.json — the bump that looks like the safest possible change
{
  "dependencies": {
    "sanitize-html": "2.17.7"   // patch bump from 2.17.5. 13 Jest suites die.
  }
}
```

```bash
# And the diagnosis that wastes the afternoon: believing the trace and
# inspecting the package it accuses.
$ node -p "require('./node_modules/sanitize-html/package.json').type"
undefined                       # CommonJS. So where is the import statement?
$ head -1 node_modules/sanitize-html/index.js
const htmlparser = require('htmlparser2');   # ...also CommonJS.
```

## RIGHT

```bash
# Diagnose by diffing the DEPENDENCIES of the two versions, not the package
# the stack trace names. One line moved:
$ npm view sanitize-html@2.17.5 dependencies.htmlparser2   # ^10.1.0
$ npm view sanitize-html@2.17.7 dependencies.htmlparser2   # ^12.0.0

# Then confirm the format change on the transitive. A dual package has BOTH
# `import` and `require` conditions; an ESM-only package has neither, just
# `default` plus "type": "module".
$ node -p "JSON.stringify(require('htmlparser2/package.json').exports['.'])"
# v10: {"import":{...},"require":{"default":"./dist/commonjs/index.js"}}   <- dual
# v12: {"types":"...","default":"./dist/index.js"}                          <- ESM only
```

```js
// jest.config.js — TRANSFORM the ESM cluster instead of ignoring it. This is
// the real fix; you do not need to move Jest to ESM.
module.exports = {
  // transformIgnorePatterns decides WHAT is eligible to be transformed.
  // The leading (?!\\.pnpm/) is required by pnpm's layout: real paths are
  // node_modules/.pnpm/htmlparser2@12.0.0/node_modules/htmlparser2/...,
  // so the package name must be matched at the SECOND node_modules segment.
  transformIgnorePatterns: [
    'node_modules/(?!\\.pnpm/)(?!(htmlparser2|domhandler|domutils|entities|dom-serializer|domelementtype)/)'
  ],
  transform: {
    // Required as well, and easy to miss: without a rule matching .js,
    // nothing in node_modules is transformed no matter what you exempt above.
    '^.+\\.js$': ['@swc/jest', {
      jsc: { parser: { syntax: 'ecmascript' }, target: 'es2020' },
      module: { type: 'commonjs' }
    }],
    '^.+\\.ts$': ['@swc/jest', { /* ...existing TS rule... */ }]
  }
}
```

```jsonc
// package.json — pinning back is a valid STOPGAP to unbreak CI in one line,
// but it is not the fix. Land the transform and move on.
{
  "dependencies": {
    "sanitize-html": "2.17.5"
  }
}
```

## NOTES

- **Node passing is not evidence the bump is safe.** `require(ESM)` (Node 22.12+)
  means the runtime, the build and a hand-run `node -e` all succeed while Jest
  fails. Never conclude "works in prod, so the test failure is a test problem" —
  here that reasoning is backwards, and the test runner is the only honest
  reporter in the set.

- **`transformIgnorePatterns` IS the fix. `moduleNameMapper` is not.** These get
  conflated, and the distinction is the whole point: `moduleNameMapper` needs an
  existing CJS build to redirect to, so it genuinely cannot help when the package
  ships none. A transform does not — it compiles the ESM source down to CJS
  itself, and needs nothing from the publisher. An earlier revision of this entry
  claimed both were useless and that only a full Jest-ESM migration would do;
  that was wrong and cost a scoping cycle. Adding six package names to
  `transformIgnorePatterns` plus a `.js` transform rule fixed it with no
  measurable change in suite runtime.

- **Check whether your repo already solves this somewhere else.** The monorepo
  that hit this had the exact technique in its dashboard Jest config, for the
  react-markdown/micromark tree, written months earlier. The second occurrence
  was scoped as a migration anyway because nobody looked. Grep your own configs
  for `transformIgnorePatterns` before estimating.

- **Do not "fix" it by overriding the transitive down a major** (`htmlparser2: ^10`
  while the parent declares `^12`). That silently pairs a package with a
  dependency major it does not claim to support, and any v12-only API it calls
  fails at runtime — trading a loud test failure for a quiet production one.

- **Where to look, generally:** when a version bump produces `Cannot use import
  statement outside a module` under Jest, diff the *dependency lists* of the old
  and new version before reading the stack trace. The trace points at the last
  CommonJS frame — the innocent caller — not at the ESM package that actually
  threw.

- Related: this is the mirror image of the pnpm entry `update-leaves-stale-store-false-green.md`.
  There a stale store makes tests pass against packages that were replaced; here
  a correctly-installed tree makes tests fail against a package that is fine.
  Both are cases where the test result is about the module graph, not the code.
