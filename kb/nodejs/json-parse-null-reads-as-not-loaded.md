---
tech: nodejs
tags: [json, guard-script, fail-open, vacuous-pass, validation, ci]
severity: high
---
# JSON.parse("null") succeeds, so a null check reads as "nothing loaded"

## PROBLEM
`JSON.parse("null")` does not throw. It returns `null`. A guard script that initialises `let data = null`, parses inside `try`, and then gates every check on `data !== null` treats a file whose whole content is `null` exactly like "the parse failed and was already reported", except that no error was pushed. The script verifies nothing and exits 0. In Roundtable a migration ledger containing `null` printed `OK: 0 migration file(s)`.

## WRONG
```js
let ledger = null;
try {
  ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
} catch (err) {
  errors.push(`not valid JSON: ${err.message}`);
}
if (ledger !== null && (typeof ledger !== "object" || Array.isArray(ledger))) {
  errors.push("must be an object"); // never reached for `null`
}
if (ledger !== null) { /* all the real checks */ }
```

## RIGHT
```js
let parsed;
let unparsable = false;
try {
  parsed = JSON.parse(readFileSync(LEDGER, "utf8"));
} catch (err) {
  unparsable = true;
  errors.push(`not valid JSON: ${err.message}`);
}
let ledger = null;
if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) ledger = parsed;
else if (!unparsable) errors.push("must be an object keyed by database");

// Backstop: whatever path was taken, verifying zero items proves nothing.
if (errors.length === 0 && total === 0) errors.push("verified 0 items");
```

## NOTES
- Test it: a guard's tests should include literal `null`, `[]` and a bare string as file contents.
- Related: `typescript/lint-must-assert-its-own-coverage`.
