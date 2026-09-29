---
tech: plex
tags: [sabnzbd, api, queue, usenet]
severity: medium
---
# SABnzbd's move to top is an undocumented mode=switch, and it answers in another shape

## PROBLEM
SABnzbd's API documentation has queue pause, resume, and delete, but no call to move a job to the top. Its own web page (Glitter) uses `mode=switch&value=<nzo_id>&value2=0`, where `value2` is the new position. The answers also differ by mode, so one refusal check for all of them is wrong: queue calls (`mode=queue&name=pause|resume|delete`) answer `{"status": bool, "nzo_ids": [...]}`, config calls (`mode=config&name=speedlimit|set_pause`) answer `{"status": true}`, but `mode=switch` answers `{"result": {"position": n, "priority": p}}` with position -1 for a job it does not have. Checking `status` on a switch reads every move as refused (or raises KeyError).

## WRONG
```python
answer = await get_json(client, "sabnzbd", sab, "/api", {"mode": "switch", "value": nzo_id, "value2": 0, "output": "json"})
if answer.get("status") is not True:
    raise Refused()  # always: a switch has no "status"
```

## RIGHT
```python
answer = await get_json(client, "sabnzbd", sab, "/api", {"mode": "switch", "value": nzo_id, "value2": 0, "output": "json"})
if (answer.get("result") or {}).get("position", -1) < 0:
    raise Refused()  # SABnzbd has no such job

# the others, as Glitter sends them:
# pause/resume one job: mode=queue&name=pause|resume&value=<nzo_id>
# remove, with its files: mode=queue&name=delete&del_files=1&value=<nzo_id>
# speed limit, % of bandwidth_max: mode=config&name=speedlimit&value=50 (100 clears it)
# pause for a while: mode=config&name=set_pause&value=<minutes>
```

## NOTES
- SABnzbd's `speedlimit` is a percentage of `bandwidth_max`; `speedlimit_abs` is the same limit in bytes a second.
- A job's `nzo_id` is the `downloadId` of the Sonarr or Radarr queue record for it.
- Read from SABnzbd 5.x's Glitter javascripts and `sabnzbd/api.py`; found building PlexDash 0.57.0 (2026-09-28).
