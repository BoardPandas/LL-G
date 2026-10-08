---
tech: jest
tags: [fixtures, uuid, case-sensitivity, vacuous-test, mutation-testing]
severity: medium
---
# Case-normalisation tests pass vacuously when fixture ids are all digits

## PROBLEM
A test that sends an upper-cased id and asserts the write lands on the lowercase row proves nothing when the fixture is `'11111111-1111-1111-1111-111111111111'`: `toUpperCase()` returns the same string, so the test passes whatever the code does. Only mutation testing (reverting the fix) exposed that the "canonical id" tests had never exercised anything.

## WRONG
```ts
const DEAL_ID = '11111111-1111-1111-1111-111111111111';
await tool.handler({ id: DEAL_ID.toUpperCase() }, token); // identical to DEAL_ID
```

## RIGHT
```ts
const DEAL_ID = 'abcdef12-3456-4789-abcd-ef0123456789';
const shouted = DEAL_ID.toUpperCase();
expect(shouted).not.toBe(DEAL_ID);                        // guard against a vacuous fixture
await tool.handler({ id: shouted }, token);
```

## NOTES
Also make the DB fake compare the way Postgres does (uuid case-insensitive, text case-sensitive), or the fake hides the bug too. Related: postgres/uuid-lookup-text-sweep-orphans-rows.
