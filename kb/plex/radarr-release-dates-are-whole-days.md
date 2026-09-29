---
tech: plex
tags: [radarr, sonarr, servarr, dates, timezone, calendar]
severity: high
---
# Radarr's release dates are whole days: do not shift them to local time

## PROBLEM
Radarr's `inCinemas`, `digitalRelease`, and `physicalRelease` arrive as ISO timestamps such as `2026-10-03T00:00:00Z`. They are dates, not moments: Radarr stores the day at midnight UTC. Converting them to local time, as is right for Sonarr's `airDateUtc`, moves every release to the evening before anywhere west of UTC, so a calendar shows it a day early. It is silent: the date is plausible.

Sonarr is the opposite trap: its `airDate` is the network's local date, so an evening west-coast episode lands on the wrong day if placed by `airDate`; place it by `airDateUtc` converted to local time.

## WRONG
```python
from datetime import datetime
day = datetime.fromisoformat(movie["digitalRelease"].replace("Z", "+00:00")).astimezone().date()
# 2026-10-03T00:00:00Z -> 2026-10-02 in America/New_York
```

## RIGHT
```python
from datetime import date, datetime
day = date.fromisoformat(movie["digitalRelease"][:10])  # Radarr: the day as given

# Sonarr: the moment, in local time
aired = datetime.fromisoformat(episode["airDateUtc"].replace("Z", "+00:00")).astimezone().date()
```

## NOTES
- When a calendar asks Sonarr for a span, ask a day either side, since converting `airDateUtc` can move an episode across the edge.
- Found building PlexDash 0.49.0 and 0.51.0 (2026-09-28) against Sonarr 4.0.20 and Radarr 6.4.4.
