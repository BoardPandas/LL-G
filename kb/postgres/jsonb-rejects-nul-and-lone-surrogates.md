---
tech: postgres
tags: [jsonb, nul, unicode, surrogates, 22P05, json-stringify, test-doubles]
severity: high
---
# `jsonb` rejects a NUL character and a lone surrogate, so tool output stored as JSON can be refused

## PROBLEM
`JSON.stringify` writes a NUL character as the escape `\u0000` and a lone surrogate as `\ud83d`. Both are valid JSON. PostgreSQL `jsonb` (and `json` when a text value is extracted) rejects them: `\u0000` fails with error `22P05` "unsupported Unicode escape sequence", and an unpaired surrogate fails the same way. `text` columns reject a raw NUL byte too.

The values that carry these characters are the ones nobody controls: command output from a Windows machine reading a UTF-16 file, a log tail, a string cut in the middle of an emoji by `slice`. The write fails only for those rows, a retry fails identically, and whatever the code does on "could not store" becomes the visible behaviour. In one case a background job's result was dropped and later reported as lost to a server restart.

A hand-written in-memory store in the tests accepts the value, so the suite stays green.

## WRONG
```ts
await db.query(
  'UPDATE jobs SET result = $2::jsonb WHERE id = $1',
  [id, JSON.stringify(result)],          // result.stdout may hold \u0000 or a lone surrogate
);
```

## RIGHT
```ts
// Clean every string (values and keys) at the point of serialising.
function storableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    typeof v === 'string' ? v.replace(/\u0000/g, '�').toWellFormed() : v,
  );
}

await db.query('UPDATE jobs SET result = $2::jsonb WHERE id = $1', [id, storableJson(result)]);
```

## NOTES
- `String.prototype.toWellFormed()` (Node 20+) replaces lone surrogates with U+FFFD. Clean object keys as well if they can come from outside.
- Give "the result could not be stored" its own terminal state and wording. Falling through to a generic failure path hides the cause.
- Put a NUL case and a lone-surrogate case in a test that runs against a real Postgres. A shared contract test run against both the fake and the database catches the fake being more permissive.
- `JSON.stringify` also throws for BigInt and circular values and returns `undefined` for `undefined`; handle those in the same place.
