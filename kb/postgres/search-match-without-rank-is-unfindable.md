---
tech: postgres
tags: [search, order-by, ranking, full-text-search, ilike, limit, pagination, exact-match, relevance]
severity: high
---
# A search predicate that matches a row does not make it findable

## PROBLEM
The usual "search everything" predicate ORs an exact-key arm together with fuzzy
text arms:

```sql
WHERE search_vector @@ websearch_to_tsquery('english', $1)
   OR subject ILIKE $2 OR description ILIKE $2 OR requester_email ILIKE $2
   OR ticket_number = $3          -- the exact-key arm
```

Every arm is correct. Membership is correct: the row you want IS in the result
set. The bug is that nothing makes it come out FIRST, and the caller's
`ORDER BY` (created_at, priority, whatever the UI last sorted by) is blind to
which arm matched. With `LIMIT 6` behind a search box, the exact match is in the
result SET but not on the result PAGE.

This looks exactly like "search is broken -- it can't find ticket 234, it
returns some unrelated ticket instead", so the investigation goes to the WHERE
clause, which is the one part that was right all along.

It scales the wrong way. Short numeric terms are the most common thing anyone
types into a search box and the worst case for the fuzzy arms, because `ILIKE
'%1%'` matches essentially the whole corpus. Measured on one production tenant
(4,773 rows):

| term  | rows matched | rank of the exact match |
|-------|--------------|-------------------------|
| `234` | 93           | 4th (just fits in 6)    |
| `1`   | 4,078        | **378th** (never shown) |

So it half-works in testing -- a fixture corpus is small enough that everything
fits on one page, and a long/rare term ranks fine -- and fails hardest on the
shortest, most-used queries against the biggest tenants.

A second, compounding trap: a search surface that reuses the app's normal list
endpoint inherits that endpoint's default filters. A queue that hides closed
rows will hide a closed row from lookup-by-id too, which removes the exact match
from the set entirely rather than merely mis-ranking it.

## WRONG
```sql
-- The number arm matches, and then the sort buries it.
SELECT id, ticket_number, subject
  FROM tickets
 WHERE tenant_id = $1
   AND (search_vector @@ websearch_to_tsquery('english', $2)
        OR subject ILIKE $3 OR description ILIKE $3
        OR ticket_number = $4)
 ORDER BY created_at DESC          -- knows nothing about WHY the row matched
 LIMIT 6;
-- term "1" -> 4078 rows, ticket #1 is 378th, the box shows six recent tickets
-- that merely contain the digit 1. Reads as "search cannot find ticket 1".
```

## RIGHT
```sql
-- Rank by WHICH arm matched, before the caller's sort.
SELECT id, ticket_number, subject
  FROM tickets
 WHERE tenant_id = $1
   AND (search_vector @@ websearch_to_tsquery('english', $2)
        OR subject ILIKE $3 OR description ILIKE $3
        OR ticket_number = $4)
 ORDER BY (ticket_number = $4) DESC NULLS LAST,   -- exact match leads
          created_at DESC                         -- caller's sort, unchanged
 LIMIT 6;
-- term "1" -> ticket #1 first, the other 4077 follow in the caller's order.
```

Build the rank in the same place that builds the WHERE, reusing the parameter
the predicate already bound, so composing it into an `ORDER BY` adds no
parameter and shifts no positional index:

```ts
// returns { whereClause, params, searchRankSql }
if (/^\d{1,18}$/.test(numericTerm)) {
  const numIdx = paramIndex; params.push(numericTerm); paramIndex++;
  const numberMatch = `t.ticket_number = $${numIdx}::bigint`;
  whereClause   += ` OR ${numberMatch}`;
  searchRankSql  = `(${numberMatch}) DESC NULLS LAST`;   // same $N, no new param
}
// caller: ORDER BY [searchRankSql, callerSort].filter(Boolean).join(', ')
```

And let a lookup-by-identifier opt out of the surface's default filters
(`include_closed=1` or equivalent), or the exact row is not in the set to rank.

## NOTES
`NULLS LAST` is not decoration here -- see
[ORDER BY ... DESC defaults to NULLS FIRST, inverting a boolean preference
clause](order-by-desc-nulls-first.md). If the ranked expression is over a
nullable column (or a COALESCE that could yield NULL), plain `DESC` sorts the
NULL non-matches ABOVE the match and the rank clause means its own opposite.
Write `NULLS LAST` even when the column is currently NOT NULL: it costs nothing
and the day someone makes it nullable there is no error, no test failure, and no
symptom except the wrong row on top.

Detection: do not test membership, test RANK. `SELECT count(*)` over the
predicate proves nothing -- the broken query returns the right count. Wrap the
search in `row_number() OVER (<the caller's ORDER BY>)` against production-sized
data and assert the exact match's rank is 1, or at minimum <= the page size:

```sql
WITH m AS (
  SELECT id, ticket_number,
         row_number() OVER (ORDER BY created_at DESC) AS rank
    FROM tickets WHERE <the search predicate>
)
SELECT * FROM m WHERE ticket_number = 234;   -- rank must be 1, not "some number"
```

A unit test asserting on the generated SQL string is weak here for the same
reason it is weak for the NULLS clause: the omitted `ORDER BY` term is invisible
to a `toContain` check on the WHERE. Assert on the rank fragment itself, then
verify the test actually fails with the fragment removed.

Related shapes this same bug takes: an autocomplete that ranks by alphabetical
name while the user types an exact SKU; a "jump to file" palette ordered by
recency; any dual-numbering scheme where a short user-facing number coexists
with a long internal id, since the short number is a substring of thousands of
unrelated ids and bodies. The general rule: when a predicate is a UNION of
"precise" and "fuzzy" reasons to match, the query must carry the reason forward
into the ordering, or the precise reason is the one that gets lost.
