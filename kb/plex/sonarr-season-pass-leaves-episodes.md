---
tech: plex
tags: [sonarr, servarr, api, monitoring, season-pass, series]
severity: high
---
# Sonarr's season pass flips only the season's flag; its own page saves the whole series

## PROBLEM
To monitor or unmonitor one season, `POST /api/v3/seasonpass` with `{"series": [{"id": N, "seasons": [{"seasonNumber": S, "monitored": true}]}]}` looks like the right call. But without `monitoringOptions` it changes only the season's own flag. The season's episodes keep their old monitored state, so a season "monitored" this way still has every episode unmonitored and nothing is searched or grabbed. It is silent: the season shows as monitored in Sonarr's series page.

Sonarr's own web page does something else: it saves the whole series with `PUT /api/v3/series/{id}`, that one season's flag changed, and Sonarr then sets every episode of that season to match (`SeriesService.UpdateSeries`, Sonarr 4.0.20).

## WRONG
```python
await client.post(f"{url}/api/v3/seasonpass", headers=key, json={
    "series": [{"id": series_id, "seasons": [{"seasonNumber": season, "monitored": True}]}]})
# the season flag flips; its episodes stay unmonitored
```

## RIGHT
```python
series = (await client.get(f"{url}/api/v3/series/{series_id}", headers=key)).json()
for s in series["seasons"]:
    if s["seasonNumber"] == season:
        s["monitored"] = True
(await client.put(f"{url}/api/v3/series/{series_id}", headers=key, json=series)).raise_for_status()
# Sonarr sets the season's episodes to match, as its own season toggle does
```

## NOTES
- Read the call a Servarr page makes from its web bundle (`/app/<app>/bin/UI/*.js` in the container) when the OpenAPI spec leaves the effect unclear.
- Radarr's page sets monitoring with `PUT /api/v3/movie/editor` `{"movieIds": [...], "monitored": bool}`.
- Found building PlexDash 0.53.0 (2026-09-28), read-only against Sonarr 4.0.20.
