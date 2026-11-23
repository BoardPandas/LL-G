---
tech: bash
tags: [git-bash, msys, windows, grep, regex, backslash, argv, spawn, tests]
severity: high
---
# Git for Windows' MSYS programs drop backslashes from argv sent by native programs

## PROBLEM
Git for Windows ships MSYS builds of `grep`, `sed`, `awk` and friends in
`usr\bin`. When a native Windows program (Node, Python, Go) starts one, the MSYS
runtime rebuilds `argv` from the Windows command line with shell-like rules, and
a backslash in an unquoted argument escapes the next character and is removed.
Node quotes an argument only when it contains a space or a quote, so a regex
like `(exec|spawn)[A-Za-z]*\(.*push` arrives as `(exec|spawn)[A-Za-z]*(.*push`.

grep then fails with `Unmatched ( or \(` and exits **2**. A guard written as
"grep exits 1, so the pattern was not found" fails on Windows. Worse, a guard
written as "a non-zero exit means no match" passes on Windows for every input,
because the pattern never ran.

The same command run from Git Bash itself is fine, because bash has already
handled the quoting.

## WRONG
```js
// Passes on Linux; on Windows grep sees "\(" as "(" and exits 2.
const r = spawnSync('grep', ['-nE', '(exec|spawn)[A-Za-z]*\\(.*push', 'src/deploy.mjs']);
assert.equal(r.status, 1, 'no code path may push');
```

## RIGHT
```js
// A bracket expression means the same thing and has no backslash to lose.
const r = spawnSync('grep', ['-nE', '(exec|spawn)[A-Za-z]*[(].*push', 'src/deploy.mjs']);
assert.equal(r.status, 1, 'no code path may push');
```

## NOTES
- Treat grep's exit 2 as an error, never as "not found": assert `status === 1`
  exactly, not `status !== 0`.
- For other escapes, use `[.]`, `[$]` and `[*]`. Or skip the external tool and
  test the regex in-process, against `readFileSync` output.
- Related argv rewriting: `git-bash-rewrites-name-equals-slash-args-to-native-exes-use-msys2-arg-conv-excl.md`
  (the other direction, bash to a native .exe) and
  `a-hand-rolled-shell-tokenizer-that-drops-every-backslash-inside-double-quotes.md`.
