---
tech: postgres
tags: [parameters, type-inference, insert-select, casts, node-postgres]
severity: medium
---
# A parameter used in two places of an `INSERT ... SELECT` needs explicit casts

## PROBLEM
In `INSERT INTO t (...) VALUES ($1, $2, ...)` Postgres infers each parameter's type from its target column. Rewrite the statement as `INSERT INTO t (...) SELECT $1, $2, ... WHERE <condition using $2>` (the usual way to make an insert conditional in one statement, for example a per-user cap) and the same parameter now appears in a select list, where it has no column to take a type from, and in a comparison, where it is inferred from the other operand. The statement is refused at parse time with `inconsistent types deduced for parameter $2`, or `could not determine data type of parameter $1`.

The `VALUES` form of the same insert worked, so the error reads like a driver or value problem.

## WRONG
```sql
INSERT INTO jobs (id, user_id, status)
SELECT $1, $2, 'working'
WHERE (SELECT COUNT(*) FROM jobs WHERE user_id = $2 AND status = 'working') < $3;
```

## RIGHT
```sql
INSERT INTO jobs (id, user_id, status)
SELECT $1::text, $2::uuid, 'working'
WHERE (SELECT COUNT(*) FROM jobs WHERE user_id = $2::uuid AND status = 'working') < $3::int
RETURNING id;
```

## NOTES
- Cast every parameter in the select list, and cast a reused parameter the same way at each use.
- No row returned means the condition was false; treat that as a normal outcome, not an error.
- A count-then-insert in one statement is still not serialised: two concurrent statements can both pass the count. Use it for a soft cap, and a lock or a constraint for a hard one.
