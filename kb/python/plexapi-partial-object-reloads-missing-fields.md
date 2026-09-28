---
tech: python
tags: [plex, plexapi, performance, partial-object, autoreload, n-plus-one]
severity: high
---
# plexapi reloads a listed item for every field Plex left out

## PROBLEM
Items from a list call (`section.all()`, `section.search()`, `show.seasons()`, `plex.continueWatching()`) are plexapi `PlexPartialObject`s. `PlexPartialObject.__getattribute__` reloads the whole item from Plex (one HTTP request) whenever an attribute reads `None` and the item is partial, unless `item._autoReload is False`. Plex omits zero counts and dates never set (`viewedLeafCount` when 0, `lastViewedAt` for never-watched), so a loop reading them makes one request per item. Reading `viewedLeafCount` over 1183 seasons made 1183 requests (6 s) instead of 0. Worse, the library-wide season list (`section.search(libtype="season")`) carries no `leafCount`/`viewedLeafCount` at all, so code built on it only works because of the reloads. Results stay correct; it is only slow, so nothing flags it.

## WRONG
```python
seasons = [s for sec in tv for s in sec.search(libtype="season")]
nearly_done = [s for s in seasons
               if s.viewedLeafCount and s.leafCount - s.viewedLeafCount <= 3]  # one reload per season
```

## RIGHT
```python
def as_listed(items):
    """Read fields as Plex listed them; a missing one reads as None instead of reloading the item."""
    for item in items:
        item._autoReload = False
    return items

shows = [s for sec in tv for s in as_listed(sec.all())]         # show list does carry counts
active = [s for s in shows if s.viewedLeafCount and s.viewedLeafCount < s.leafCount]
nearly_done = [season for show in active for season in as_listed(show.seasons())  # children carry counts
               if season.viewedLeafCount and 1 <= season.leafCount - season.viewedLeafCount <= 3]
```
Measure with a wrapper that counts `plex.query` calls before trusting a loop over listed items.

## NOTES
- Playlist items' `isPlayed` did not reload (`viewCount` defaults to 0).
- plexapi also has the global `plexapi.autoreload` config and `USER_DONT_RELOAD_FOR_KEYS`; both are process-wide, so prefer the per-item switch.
