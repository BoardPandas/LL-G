---
tech: pnpm
tags: [cli, scripts, arguments, double-dash, jest, ci]
severity: high
---
# `pnpm run <script> -- --flag` turns the flag into a positional argument

## PROBLEM

npm requires `--` to pass extra arguments through `npm run` to the underlying
binary, so the form is muscle memory. In pnpm (v11.15.1) that same `--` is what
breaks it: the flag reaches the binary as a **positional argument** instead of a
flag. Dropping `--` is what actually works -- the inverse of the npm rule.

Nothing warns you. pnpm exits without complaint and the receiving tool reports a
problem several layers away from the real cause. With jest, `--forceExit` is
taken as a test *path pattern*, matches no files, and the run fails with a
diagnostic listing `testMatch` / `testPathIgnorePatterns` / `testRegex` -- which
sends you off auditing jest config for a bug that is not there. The word
`Pattern: --forceExit - 0 matches` in the output is the only real tell.

How loudly this surfaces is entirely up to the receiving CLI. jest errors on a
pattern that matches nothing, so you find out. A tool that ignores unrecognized
positional arguments will accept the invocation, silently skip the flag, and
report success -- a CI step that looks green while never having enabled the thing
you asked for.

## WRONG

```bash
# The npm habit. In pnpm the flag becomes a positional arg.
pnpm test -- --forceExit
#   Pattern: --forceExit - 0 matches
#   [ELIFECYCLE] Test failed.   <- exit 1, and the error blames your jest config

# Same trap in a workflow step, where the misdirection costs more.
- name: Test
  run: pnpm test -- --forceExit
```

## RIGHT

```bash
# Omit the separator -- pnpm forwards the flag as a flag.
pnpm run test --listTests        # works: 128 test files

# Or bypass the script runner entirely.
pnpm exec jest --forceExit       # works

# Most robust for CI: name the invocation in package.json, pass nothing through.
# Self-documenting, and immune to whichever pass-through rule the runner uses.
{
  "scripts": {
    "test": "jest",
    "test:ci": "jest --forceExit"
  }
}
```
```yaml
- name: Test
  run: pnpm run test:ci
```

## NOTES

Verified on pnpm 11.15.1 with jest 30. Confirmed by comparing three forms
against the same script: `pnpm test -- --listTests` produced 0 matches, while
both `pnpm run test --listTests` and `pnpm exec jest --listTests` listed all 128
test files.

The silent-failure case is inferred, not observed: jest happens to error on an
unmatched pattern, so the jest instance of this bug is loud. The risk is the same
mistake against a CLI that tolerates stray positionals.

Do not "verify" the pattern by finding an existing `pnpm ... -- <arg>` in a repo
that works. A command like `pnpm --filter web test -- a11y --runInBand` can look
like proof the separator is fine when the first argument after `--` is a genuine
positional (a test-name filter). That says nothing about whether the flag after
it arrived as a flag.

Related: [[v11-overrides-workspace-yaml-and-ranges]] -- another case of pnpm v11
silently ignoring input that the npm-shaped equivalent would have honoured.
