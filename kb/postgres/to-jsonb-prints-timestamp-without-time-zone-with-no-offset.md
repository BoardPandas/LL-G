---
tech: postgres
tags: [timestamp, timestamptz, to_jsonb, json, timezone, browser, date-parsing]
severity: high
---
# `to_jsonb` prints a `timestamp without time zone` with no offset, and a browser reads it as local time

## PROBLEM
A `timestamp without time zone` column serialised by Postgres itself (`to_jsonb(row)`, `row_to_json`, `jsonb_agg`, `json_build_object`) comes out as `"2026-11-27T05:58:10.123456"`: no `Z`, no offset. JavaScript's `new Date()` reads a date-time string with no offset as LOCAL time, so every viewer sees the instant shifted by their own UTC offset.

It hides well:

- The same column read as an ordinary result column goes through the driver's type parser (node-pg builds a `Date`), which is correct when the server process runs in UTC. Only the SQL-built JSON path is wrong, so most screens over the same table look fine.
- SQL comparisons in the same query (`ts > NOW() - INTERVAL '5 minutes'`) are correct, so a status computed on the server is right while the age printed beside it is wrong.
- Developers and CI in UTC see nothing at all.
- An age formatter that takes `Math.abs(now - then)` turns "five hours in the future" into a plausible "4h 59m ago".

Observed: a device list showed "Active" beside "4h 59m ago" for every device seen a minute earlier, for a viewer at UTC-5. A device silent for eight hours read three.

## WRONG
```sql
WITH page AS (
  SELECT d.id, h.ts AS last_seen   -- ts is timestamp without time zone
  FROM devices d JOIN heartbeats h ON h.device_id = d.id
)
SELECT jsonb_agg(to_jsonb(page)) AS rows FROM page;
-- "last_seen": "2026-11-27T05:58:10.123456"
```

## RIGHT
```sql
WITH page AS (
  SELECT d.id, h.ts::timestamptz AS last_seen
  FROM devices d JOIN heartbeats h ON h.device_id = d.id
)
SELECT jsonb_agg(to_jsonb(page)) AS rows FROM page;
-- "last_seen": "2026-11-27T05:58:10.123456+00:00"
```

## NOTES
- The cast interprets the value in the session time zone, which is the same assumption the query's own comparisons against `NOW()` already make. Use `ts AT TIME ZONE 'UTC'` instead only if you know the column holds UTC regardless of session settings.
- Test it where the bug lives: assert the serialised string ends in `Z` or an offset. A test that only parses the value passes in a UTC runner.
- Do not let a formatter take the absolute value of an age. A timestamp in the future is a defect worth seeing.
- The durable fix is a `timestamptz` column; the cast is the fix that needs no migration.
