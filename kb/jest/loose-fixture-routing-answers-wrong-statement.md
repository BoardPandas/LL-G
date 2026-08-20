---
tech: jest
tags: [test-fake, routing, mock, vacuous-test, sql, false-green]
severity: high
---
# A fake that routes queries by a loose substring answers the wrong statement

## PROBLEM

A hand-written DB fake usually routes by matching text in the SQL. The match
that reads as obviously correct — a table name, `COUNT(*)`, `MAX(...)` — is
frequently a substring of a *different* statement the same handler issues.

The fake then answers statement B with statement A's canned rows. Nothing
errors. The assertions still pass, because the shape they check is the shape
they got. The test now asserts a property of a query that never ran, and the
suite stays green through the bug **and** through its fix.

This is worse than the classic missing-column fake
([[db-fake-ignores-column-hides-bug]]), because the fake is not merely
incomplete — it is confidently wrong, and the routing looks like the most
obvious line in the file.

Three real collisions from one afternoon on one codebase:

- Routing on `MAX(snapshot_date)` when two tables carry that column, so a
  regression that read the *raw* table instead of the completeness marker got
  the marker's answer and passed.
- Routing on `COUNT(*)` ahead of the row read, after a correlated
  `COUNT(*)` subquery was added to the row read's SELECT list. The handler got
  `{total: 2}` where it expected a row, and 500'd — that one at least failed
  loudly. The dangerous direction is the reverse.
- Routing on `is_vip` to tell a VIP count from a points-of-contact count, when
  the shared SELECT clause names **both** columns on every query. The
  points-of-contact assertions ran against the VIP query and passed.

The tell is that the discriminator you chose is *incidental* to the statement
rather than *definitive* of it.

## WRONG

```ts
function fakeDb(rows: Rows) {
  return {
    query: jest.fn(async (sql: string) => {
      // Both the row read and the total read touch this table.
      if (sql.includes('FROM crm_comments')) return { rows: [ROW] }
      // The row read's SELECT list now contains a COUNT(*) subquery, so this
      // never runs -- or worse, it runs INSTEAD of the line above.
      if (sql.includes('COUNT(*)')) return { rows: [{ total: 2 }] }
      // Every query selects is_vip; this cannot tell the two filters apart.
      if (sql.includes('is_vip')) return { rows: [{ total: 5 }] }
      return { rows: [] }
    }),
  }
}
```

## RIGHT

```ts
function fakeDb(rows: Rows) {
  return {
    query: jest.fn(async (sql: string) => {
      // Route on what makes each statement UNIQUE: its predicate, its target
      // table, its first clause -- not on a token it shares with a sibling.
      if (sql.includes('COALESCE(u.is_vip, false) = true')) return { rows: [{ total: 5 }] }
      if (sql.includes('COALESCE(u.is_poc, false) = true')) return { rows: [{ total: 2 }] }

      // Order matters when one pattern is a superset of another. Match the
      // narrower statement FIRST and say why in a comment, so the next person
      // does not "tidy" the order.
      if (sql.includes('FROM crm_pipeline_snapshot_days')) return { rows: [DAY] }
      if (sql.includes('FROM crm_pipeline_snapshots')) return { rows: [SNAPSHOT] }

      // Anything unrecognised is a bug in the test, not an empty result.
      throw new Error(`Unrouted query in fake:\n${sql}`)
    }),
  }
}
```

Then prove the routing actually discriminates, which assertions alone cannot:

```ts
// Give the two branches DIFFERENT answers and assert the caller got the right
// one. Identical fixtures make a mis-routed fake indistinguishable from a
// correct one.
it('reads the completeness marker, not the raw rows', async () => {
  const q = fakeDb({ completeDays: ['2026-08-01'], partialDays: ['2026-08-15'] })
  const result = await getReport(q)
  expect(result.current_date).toBe('2026-08-01')
})
```

## NOTES

- **Throw on an unrouted query.** A fake that returns `{rows: []}` by default
  turns every routing mistake into a silent empty result, which is exactly the
  shape that passes an assertion like `expect(list).toEqual([])`.
- **Mutation-check the routing itself, not just the code.** Break the
  implementation so it reads the wrong table, and confirm the test fails. If it
  still passes, the fake is answering both branches identically and the test
  was never about the table.
- **Watch for shared SELECT clauses.** A builder that produces one column list
  for every query means no column name distinguishes any two of them. Only the
  WHERE clause does.
- **A substring is a superset relationship.** `crm_pipeline_snapshots` is not a
  substring of `crm_pipeline_snapshot_days` (the `s` differs), but
  `FROM crm_comments` matches both `SELECT ... FROM crm_comments k` and
  `SELECT COUNT(*) FROM crm_comments`. Check the direction before relying on it.
- Related: [[db-fake-ignores-column-hides-bug]] — same false-green outcome, the
  other half of the fake being wrong.
