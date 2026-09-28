---
tech: plex
tags: [tautulli, plex, get_history, api, dates, grouping]
severity: high
---
# Tautulli `get_history`: `start_date` is one day, and ungrouped rows count every resume

## PROBLEM
Two parameters of Tautulli's `get_history` read one way and behave another, and both fail silently:

- `start_date` ("YYYY-MM-DD") returns history for **that exact date only**, not from it onward. A "since" filter
  built on it returns nothing, or one day, and looks like an empty history. `after` (on or after, inclusive) and
  `before` are the range bounds.
- `grouping=0` returns one row per session, so a play paused and resumed later becomes two or more rows. Counting
  rows as plays inflates rewatch and play counts (one episode read 19 ungrouped, 12 grouped, on a real server).
  Grouped rows (`grouping=1`, Tautulli's default setting) join the resumes and still carry `started` and `stopped`.

Also: history rows carry no `section_id` (use `get_libraries_table` for per-library plays), no transcode reasons
(only live `get_activity` sessions have `video_decision` and friends), and plays shorter than Tautulli's own ignore
interval are never logged, so "short plays" counted from history are nearly always zero.

## WRONG
```python
# "plays since September 1" -- actually only September 1
params = {"cmd": "get_history", "start_date": "2026-09-01", "length": 5000}
# rewatch counts that include every resume of a paused episode
params = {"cmd": "get_history", "grouping": 0, "length": 20000}
```

## RIGHT
```python
params = {"cmd": "get_history", "after": "2026-09-01", "length": 5000}     # on or after the date
params = {"cmd": "get_history", "grouping": 1, "length": 20000}            # a resumed play counts once
```

## NOTES
- Tautulli's API reference states it in one line each: `start_date` "History for the exact date", `after` "History
  after and including the date". Easy to miss when the parameter name reads like a range start.
- Found building PlexDash's Activity pages (2026-09-28).
