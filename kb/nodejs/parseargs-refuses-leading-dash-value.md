---
tech: nodejs
tags: [util-parseargs, cli, argument-parsing, testing, node-test]
severity: medium
---
# `util.parseArgs` refuses a "-"-leading option value before your validator sees it

## PROBLEM
Under `strict: true`, `parseArgs` throws `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` for `--repo -evil` ("Option '--repo' argument is ambiguous. ... To specify an option argument starting with a dash use '--repo=-XYZ'") before any of your own validation runs. A test written to prove that your CLI refuses a leading-dash value with your own message gets parseArgs' message instead, or passes for the wrong reason if it only checks for a non-zero exit.

## WRONG
```js
// meant to test OUR refusal of a leading-dash repo
const result = runCli(["--repo", "-evil"]);
assert.match(result.stderr, /repo must not start with "-"/); // fails: parseArgs refused it first
```

## RIGHT
```js
const result = runCli(["--repo=-evil"]); // the inline value reaches the validator
assert.match(result.stderr, /repo must not start with "-"/);
```

## NOTES
- Keep a separate test for the spaced form that asserts parseArgs' "ambiguous" refusal, so both paths stay covered.
- Verified on Node 24.21, 2026-10-12.
