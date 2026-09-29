---
tech: plex
tags: [bazarr, subtitles, api, history]
severity: low
---
# Bazarr's history `action` is a bare number: read the names from its code

## PROBLEM
`GET /api/episodes/history` and `/api/movies/history` give each row an `action` as a number with no label, and the API spec does not list them. Guessing (0 downloaded, 1 upgraded, ...) mislabels every row. Bazarr 1.6.1's own code gives: 1 "Automatically Downloaded", 2 "Manually Downloaded", 3 "Upgraded" (its History page's filter), 5 synced (`subtitles/tools/subsyncer.py` writes `action=5`), 6 translated (the translator services write `action=6`). Others were not found in the code; treat them as unknown.

## WRONG
```python
ACTIONS = ["Downloaded", "Upgraded", "Deleted", "Synced"]
label = ACTIONS[row["action"]]  # off by one, and IndexError on 5 or 6
```

## RIGHT
```python
ACTIONS = {1: "Downloaded", 2: "Downloaded by hand", 3: "Upgraded", 5: "Synced", 6: "Translated"}
label = ACTIONS.get(row["action"], "Changed")
```

## NOTES
- Found with `grep -oE ".{0,60}Manually Downloaded.{0,200}" /app/bazarr/bin/frontend/build/assets/*.js` and `grep -rn "action=[0-9]" /app/bazarr/bin/bazarr` inside the container (BusyBox grep has no `--include`).
- Bazarr's own Search on a series is `PATCH /api/series?seriesid=...&action=search-missing` (the whole series), on a movie `PATCH /api/movies?radarrid=...&action=search-missing`.
- Checked 2026-09-29 building PlexDash 0.69.0.
