---
tech: plex
tags: [plex, pms, api, statistics, bandwidth, resources, openapi]
severity: medium
---
# Plex's /statistics endpoints: timespan is the bucket, and only some answer

## PROBLEM
`GET /statistics/resources` and `GET /statistics/bandwidth` are what Plex's own dashboard draws from, but neither is in the official PMS OpenAPI spec (1.2.3), and `timespan` does not mean "how far back":

- `/statistics/resources` answers only `timespan=6`: 5-second samples of host and Plex CPU and memory (`hostCpuUtilization`, `processCpuUtilization`, `hostMemoryUtilization`, `processMemoryUtilization`) for the last 2 minutes. `timespan=1`, `3600`, and the others return an empty container, so there is no stored CPU history to read; sample it yourself for a trend.
- `/statistics/bandwidth` takes the bucket size as `timespan`: 6 seconds (last 2 minutes), 4 hours (about 36 days kept), 3 days, 2 weeks, 1 months; 5 returns nothing. Each `StatisticsBandwidth` row is one account and device in one bucket (`at`, `bytes`, `lan`, `accountID`, `deviceID`), with `Account` and `Device` elements naming them in the same answer.
- Buckets start at a local hour, local midnight, or the first of the month (steps of 82800 s show up across a DST change), and a row exists only where something was sent. Summing the rows and treating the list as a continuous series drops the empty hours, so a chart shifts.

## WRONG
```python
rows = [r for r in plex.query("/statistics/bandwidth?timespan=24") if r.tag == "StatisticsBandwidth"]  # not "24 hours"
per_hour = [int(r.attrib["bytes"]) for r in rows[-24:]]  # rows are per account and device, and empty hours are missing
cpu_day = plex.query("/statistics/resources?timespan=86400")  # empty: only timespan=6 answers
```

## RIGHT
```python
from datetime import datetime, timedelta
top = datetime.now().replace(minute=0, second=0, microsecond=0)
starts = [top - timedelta(hours=n) for n in range(23, -1, -1)]  # local hour starts, oldest first
index = {s: i for i, s in enumerate(starts)}
local, remote = [0] * 24, [0] * 24
for r in plex.query("/statistics/bandwidth?timespan=4"):  # 4 = hourly buckets
    if r.tag == "StatisticsBandwidth" and (i := index.get(datetime.fromtimestamp(int(r.attrib["at"])))) is not None:
        (local if r.attrib.get("lan") == "1" else remote)[i] += int(r.attrib["bytes"])

now = plex.query("/statistics/resources?timespan=6")  # CPU and memory now; keep your own samples for a trend
```

## NOTES
- Checked read-only on Plex 1.43.4 (Linux, Docker), 2026-09-28; each call answered in about 1 ms, the hourly bandwidth answer held 3,379 rows.
- Account names come back in the answer: treat them as the server owner's data.
- Related: [Plex's official OpenAPI spec omits /library/metadata/{ids}/children](official-openapi-spec-omits-children.md).
