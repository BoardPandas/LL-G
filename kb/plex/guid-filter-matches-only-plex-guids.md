---
tech: plex
tags: [plex, plexapi, guid, tmdb, tvdb, sonarr, radarr, matching]
severity: high
---
# Plex's `guid=` filter matches only `plex://` guids: list with `includeGuids=1` to match TMDB or TVDB ids

## PROBLEM
To link a Sonarr series or a Radarr movie to its Plex item you need Plex's ratingKey for a TVDB or TMDB id.
The obvious call is a library filter on the guid, but Plex's `guid=` filter compares against the item's own
`plex://show/...` or `plex://movie/...` guid only. Asking for `tmdb://603` or `tvdb://81189` returns an empty
container with a 200, so every lookup silently finds nothing and the page just has no Plex link.

The outside ids are there: they are child `<Guid id="tmdb://..."/>` elements, which Plex sends only when asked.
On lancelot (2026-09-29) Plex had TMDB ids for all 2,035 movies and 390 of 394 shows, and TVDB ids for 392.

## WRONG
```python
# One call per title, and every one comes back empty for tmdb:// or tvdb:// ids
section = plex.library.section("Movies")
hits = section.search(guid=f"tmdb://{tmdb_id}")      # [] even when the movie is there
key = hits[0].ratingKey if hits else None
```

## RIGHT
```python
# One lean listing per movie or show library, with the guids, then a dict both ways
LEAN = ("includeGuids=1&excludeElements=Role,Director,Writer,Genre,Country,Image,UltraBlurColors,Collection,Media"
        "&excludeFields=summary")

def outside_ids(plex, section_key: str, prefix: str) -> dict[int, str]:
    """{tmdb or tvdb id: Plex ratingKey} for one library; prefix is "tmdb://" or "tvdb://"."""
    found = {}
    for item in plex.query(f"/library/sections/{section_key}/all?{LEAN}"):
        value = next((g.attrib["id"][len(prefix):] for g in item
                      if g.tag == "Guid" and g.attrib.get("id", "").startswith(prefix)), "")
        if value.isdigit():
            found[int(value)] = item.attrib["ratingKey"]
    return found
```
Keep the map (minutes, not per request). For all 2,429 titles it took about 1 s and a 24 MB peak while parsing;
kept, the joined map was about 1 MB.

## NOTES
- `plexapi` `section.all(includeGuids=True)` also fills `item.guids`, but builds full objects; the raw query with
  `excludeElements` is far lighter.
- Some items have no outside id (home videos, unmatched titles). Fall back to Sonarr's own `tmdbId` or `tvdbId`
  (Sonarr had TMDB ids for 373 of 378 series), and treat the rest as not in Plex rather than guessing.
- Very large libraries (tens of thousands of episodes) should be paged; see
  [library-listing-memory-page-it.md](library-listing-memory-page-it.md). Movie and show listings are small.
- Found in PlexDash (`plexplaylist/media_links.py`, links everywhere).
