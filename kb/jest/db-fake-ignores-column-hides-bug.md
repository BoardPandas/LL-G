---
tech: jest
tags: [test-double, fake, database, sql, false-negative, regression, coverage]
severity: high
---
# A hand-written DB fake that ignores a column makes a bug look like correct behaviour

## PROBLEM

Hand-rolled `query(sql, values)` fakes are the right call in a lot of codebases
— they are fast, need no database, and can be made to enforce the real
migration's UNIQUE constraints. But they model only the columns someone
remembered to model, and a column the fake does not carry simply reads as
`undefined` or `null`.

That turns a silent production bug into a *passing test*. Worse, it invites a
test that asserts the broken behaviour as expected, complete with a careful
comment explaining why the value is absent — at which point the bug is now
protected by the suite.

Real instance: a session's `started_at` was set on one code path and not on the
other, so sessions taking the common path reported no duration for their entire
life. The fake did not carry `started_at`. The test asserted
`expect(duration).toBeNull()` and passed, with a paragraph documenting the
"gap". The implementation fix then changed nothing, because the fake still
ignored the column — the suite stayed green through both the bug and the fix.

## WRONG

```ts
// The fake models the columns the author was thinking about.
if (text.includes('UPDATE sessions SET consent_granted_at')) {
  row.consent_granted_at = now();
  row.status = nextStatus;
  // started_at not modelled -- the real UPDATE sets it, this does not
  return { rows: [project(row)] };
}

// ...so this passes, and encodes the defect as the contract:
it('has no duration for a consent-gated session', async () => {
  const ended = await terminate(db, id);
  expect(sessionDurationSeconds(ended)).toBeNull(); // <- the bug, asserted
});
```

## RIGHT

```ts
// Mirror every column the real statement writes, and say why it is there.
if (text.includes('UPDATE sessions SET consent_granted_at')) {
  row.consent_granted_at = now();
  row.status = nextStatus;
  // Mirrors the migration's `started_at = CASE WHEN $3 THEN
  // COALESCE(started_at, NOW()) ELSE started_at END`. The fake has to carry
  // this: it was the fake ignoring the column that let the duration gap look
  // like correct behaviour in the first place.
  if (granted) row.started_at = row.started_at ?? now();
  return { rows: [project(row)] };
}

it('starts the clock when consent is granted', async () => {
  expect(granted.startedAt).toEqual(t0);
  expect(sessionDurationSeconds(ended)).toBe(300);
});
```

## NOTES

When a test documents a "known gap" rather than asserting desired behaviour,
treat that as a finding to escalate, not a comment to write. An agent or
colleague who reports "this looks wrong upstream, I did not weaken the test" is
doing the right thing — but the fake still has to be fixed, or the eventual
implementation fix is unverified and the suite lies in both directions.

Two cheap defences:

* Make the fake **throw on an unmatched query** (`throw new Error(\`unexpected
  query: ${text}\`)`). A fake that silently returns `{rows: []}` makes a broken
  query indistinguishable from an empty result.
* Back enum columns, widths and CHECK constraints with a **migration
  integration test against a real database**, sourcing expected values from the
  TypeScript contract rather than by parsing the migration SQL. Unit fakes have
  no column widths and no constraints, and that gap is where this class of
  defect lives.

Also beware fixtures pinned to a fixed calendar date when the code under test
reads the wall clock — those pass or fail depending on when the suite runs.
Anchor such fixtures to `new Date()`.
