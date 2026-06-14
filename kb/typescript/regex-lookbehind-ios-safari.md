---
tech: typescript
tags: [regex, lookbehind, ios-safari, browser-compat, client-js, syntax-error]
severity: high
---
# Regex lookbehind is a parse-time SyntaxError on iOS Safari <16.4 (breaks the whole module)

## PROBLEM
A regex literal using lookbehind, `/(?<=prefix)foo/` (positive) or `/(?<!x)y/` (negative), is a SYNTAX error rather than a runtime error on iOS Safari before 16.4 (and old desktop Safari). Because it fails when the engine PARSES the script, the ENTIRE module or file fails to load, taking down unrelated code in the same file, not just the regex call site. It works on desktop Chrome, Firefox, and current Safari, so it passes every dev check and only breaks on older iPhones and iPads, often as a blank screen or a dead feature with no obvious cause. Lookahead, `(?=...)` and `(?!...)`, is fine; only LOOKBEHIND is affected. Minifiers and bundlers do NOT transpile it away (it is valid modern syntax), so a build step will not save you.

## WRONG
```js
// Strip the leading "$" from a price token. The lookbehind throws a
// SyntaxError at PARSE time on iOS Safari <16.4, so the whole module
// containing this line fails to load, not just this one call.
const amount = token.match(/(?<=\$)\d+(\.\d+)?/)?.[0];

// Negative lookbehind, same failure mode.
const noTax = line.replace(/(?<!sub)total/gi, "TOTAL");
```

## RIGHT
```js
// Capture the prefix in a group and read the captured TARGET instead of
// asserting on a hidden prefix. No lookbehind, parses everywhere.
const amount = token.match(/\$(\d+(?:\.\d+)?)/)?.[1];

// For the "not preceded by" case, match the optional prefix and branch in
// the replacer (or restructure so lookbehind is not needed at all).
const noTax = line.replace(/(sub)?total/gi, (m, sub) => (sub ? m : "TOTAL"));
```

## NOTES
Surfaced in the TCG dashboard's static client JS (`dashboard/src/public/*` is served raw to browsers, including iOS Safari, with no transpile step). Keep lookbehind only in server or Node code where the runtime version is known. Quick audit: grep client JS for `(?<=` and `(?<!`. Safari added lookbehind in 16.4 (March 2023); V8 and SpiderMonkey shipped it years earlier, so anything older than 16.4 is exposed. A `try/catch` around the call site does NOT help, because a parse error means the file never executes at all.
