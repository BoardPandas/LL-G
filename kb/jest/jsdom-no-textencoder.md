---
tech: jest
tags: [jest, jsdom, textencoder, utf-8, ics, testing]
severity: medium
---
# jsdom has no TextEncoder, so byte-counting helpers crash the suite

## PROBLEM
Jest's `jest-environment-jsdom` does not define `TextEncoder`, so a production helper that counts UTF-8 bytes with `new TextEncoder()` (for example RFC 5545 .ics 75-octet line folding) throws `ReferenceError: TextEncoder is not defined` and the whole suite fails to run, even though every browser has it.

## WRONG
```ts
function foldLine(line: string): string {
  const encoder = new TextEncoder() // ReferenceError under jsdom
  for (const char of line) { const bytes = encoder.encode(char).length /* ... */ }
}
```

## RIGHT
```ts
function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
}
// for...of yields whole code points, so surrogate pairs/emoji are never split.
for (const char of line) { const bytes = utf8Length(char) /* ... */ }

// In the test, count octets without TextEncoder/Buffer:
const octets = (s: string) => encodeURIComponent(s).replace(/%[0-9A-F]{2}/g, "x").length
```

## NOTES
Polyfilling `TextEncoder` in the Jest setup also works, but keeping production code free of it avoids the environment dependency. Test with both 2-byte ("é") and 4-byte (emoji) input.
