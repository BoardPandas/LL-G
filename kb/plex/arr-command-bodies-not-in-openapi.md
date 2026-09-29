---
tech: plex
tags: [sonarr, radarr, servarr, api, commands, openapi]
severity: medium
---
# Sonarr's and Radarr's command bodies are not in their OpenAPI specs

## PROBLEM
`POST /api/v3/command` starts a search, a refresh, and every other task, but the specs type its body as a generic `CommandResource` with a `name` and nothing about each command's own fields. The fields differ per command: Sonarr takes `SeasonSearch` with `seriesId` and `seasonNumber`, `EpisodeSearch` with a list `episodeIds`, while Radarr's movie commands take `movieIds` lists even for one movie. Guessing (`movieId`, `episodeId`, `seasonId`) from the resource names gets them wrong.

## WRONG
```python
await post(client, "radarr", radarr, "/api/v3/command", body={"name": "MoviesSearch", "movieId": 42})
await post(client, "sonarr", sonarr, "/api/v3/command", body={"name": "EpisodeSearch", "episodeId": 7})
```

## RIGHT
```python
# Read from each app's web code (/app/<app>/bin/UI/*.js in the container), 2026-09-28:
SONARR = {"series": {"name": "SeriesSearch", "seriesId": 3},
          "season": {"name": "SeasonSearch", "seriesId": 3, "seasonNumber": 2},
          "episode": {"name": "EpisodeSearch", "episodeIds": [7]},
          "refresh": {"name": "RefreshSeries", "seriesId": 3},
          "missing": {"name": "MissingEpisodeSearch", "monitored": True},
          "upgrade": {"name": "CutoffUnmetEpisodeSearch", "monitored": True}}
RADARR = {"search": {"name": "MoviesSearch", "movieIds": [42]},
          "refresh": {"name": "RefreshMovie", "movieIds": [42]},
          "missing": {"name": "MissingMoviesSearch"}, "upgrade": {"name": "CutoffUnmetMoviesSearch"}}
```

## NOTES
- Grep the bundle for `name: '` near the button's text to find the body the app's own page sends.
- Found building PlexDash 0.52.0 (2026-09-28), Sonarr 4.0.20 and Radarr 6.4.4.
