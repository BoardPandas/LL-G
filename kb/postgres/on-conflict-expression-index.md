---
tech: postgres
tags: [on-conflict, upsert, expression-index, unique-index, arbiter]
severity: medium
---
# ON CONFLICT must echo the exact expression of an expression-based unique index

## PROBLEM
`INSERT ... ON CONFLICT` needs a conflict arbiter that matches the target unique
index. For an ordinary column index you list the columns; but for an EXPRESSION
unique index you must repeat the exact expression(s), not just the columns.
Listing the bare columns (or omitting the matching expression) raises
`there is no unique or exclusion constraint matching the ON CONFLICT
specification` (42P10), so the upsert errors at runtime. This bites
unordered-pair indexes such as `(msp_id, LEAST(a,b), GREATEST(a,b))`.

## WRONG
```sql
CREATE UNIQUE INDEX uniq_pair
  ON ticket_links (msp_id, LEAST(ticket_a, ticket_b), GREATEST(ticket_a, ticket_b));

-- 42P10: no unique constraint matches this ON CONFLICT spec
INSERT INTO ticket_links (msp_id, ticket_a, ticket_b, link_type)
VALUES ($1, $2, $3, $4)
ON CONFLICT (msp_id, ticket_a, ticket_b) DO NOTHING;
```

## RIGHT
```sql
INSERT INTO ticket_links (msp_id, ticket_a, ticket_b, link_type)
VALUES ($1, $2, $3, $4)
ON CONFLICT (msp_id, LEAST(ticket_a, ticket_b), GREATEST(ticket_a, ticket_b))
  DO UPDATE SET link_type = EXCLUDED.link_type;
```

## NOTES
Same family as partial-index upserts, where the conflict clause must also echo the
index's `WHERE` predicate. `ON CONFLICT DO NOTHING` with NO target works for any
unique violation, but `DO UPDATE` requires an explicit, matching arbiter.
