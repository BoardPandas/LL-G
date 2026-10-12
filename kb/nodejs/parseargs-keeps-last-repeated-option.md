---
tech: nodejs
tags: [util-parseargs, cli, argument-parsing, validation, strict]
severity: high
---
# `util.parseArgs` silently keeps the last value of a repeated option

## PROBLEM
Unless an option is declared `multiple: true`, `parseArgs` accepts it repeated and keeps the last value: `--scope a --scope b` gives `{ scope: "b" }`, with no error even under `strict: true`. A value pasted twice, or a flag a wrapper script already sets, quietly replaces the first. For a CLI that mints credentials or writes SQL, that is the wrong scope or target with no warning.

## WRONG
```js
const { values } = parseArgs({ args, options: { scope: { type: "string" } }, strict: true });
// --scope table:rw --scope admin  ->  values.scope === "admin"
```

## RIGHT
```js
const { values, tokens } = parseArgs({ args, options, strict: true, tokens: true });

const seen = new Map();
for (const token of tokens) {
  if (token.kind === "option") seen.set(token.name, (seen.get(token.name) ?? 0) + 1);
}
const repeated = [...seen].filter(([, n]) => n > 1).map(([name]) => `--${name}`);
if (repeated.length > 0) throw new Error(`${repeated.join(", ")} given more than once`);
```

## NOTES
- `token.name` is the long option name whatever the spelling, so `--scope a`, `--scope=a` and a short alias all count as the same option.
- Where repeats are meaningful, declare `multiple: true` and handle the array.
- Verified on Node 24.21, 2026-10-12.
