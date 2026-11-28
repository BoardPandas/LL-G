---
tech: postgres
tags: [check-constraint, now, transaction-start-time, concurrency, update, trigger, timestamps]
severity: high
---
# A CHECK that compares a stored column with now() breaks concurrent updates

## PROBLEM
A `CHECK` constraint is re-evaluated on every `UPDATE` of the row, not only when the checked column changes, and `now()` is the **updating transaction's start time**. So `CHECK (created_at <= now())` fails for any transaction that began before the row's creator committed: the row's `created_at` is later than that transaction's `now()`, even though the update does not touch `created_at`.

Single-connection tests never show it, because every statement there starts after the previous one finished. Under load it appears as an occasional check-constraint violation on an unrelated update.

## WRONG
```sql
CREATE TABLE session (
  id         uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz,
  CHECK (created_at <= now())      -- re-checked on every UPDATE of the row
);

-- Connection A: BEGIN;                      (now() fixed at 12:00:00.000)
-- Connection B: INSERT INTO session ...;    (created_at 12:00:00.200, commits)
-- Connection A: UPDATE session SET last_seen = now() WHERE id = ...;
--   ERROR: new row for relation "session" violates check constraint
```

## RIGHT
```sql
-- Put the time rule in a trigger that fires on INSERT, or only when that column changes.
CREATE FUNCTION session_created_at_not_future() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_at > now() THEN
    RAISE EXCEPTION 'created_at is in the future';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER session_created_at_guard
  BEFORE INSERT OR UPDATE OF created_at ON session
  FOR EACH ROW EXECUTE FUNCTION session_created_at_not_future();
```

## NOTES
- Test with two connections: open a transaction on one, insert and commit on the other, then update the new row from the first.
- The same applies to any `CHECK` that compares a stored value with `now()`, `CURRENT_TIMESTAMP` or `CURRENT_DATE`.
