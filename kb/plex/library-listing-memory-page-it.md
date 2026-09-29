---
tech: plex
tags: [plex, pms, plexapi, memory, paging, library, xml]
severity: medium
---
# A whole Plex library listing costs memory in proportion to its size: page it

## PROBLEM
Scanning a library's items with their media (`/library/sections/{id}/all?type=4` for episodes, `type=1` for movies) in one request makes Plex send every item at once, and plexapi (or any XML parser) builds the whole tree in memory. On a 12,738-episode library the process's peak memory rose from 57 MB to 248 MB, and trimming the answer with `excludeElements=Role,Director,Writer,Genre,Country,Image,UltraBlurColors,Collection` and `excludeFields=summary,art,thumb,...` barely helped (the Media and Part elements are the bulk). Peak memory never comes back down in a long-running Python process, so a dashboard page or a job that does this once holds the high-water mark for its whole life. It is silent: the scan works and is fast (about 2.5 s).

Paging with `X-Plex-Container-Start` and `X-Plex-Container-Size` keeps only one page parsed at a time: at 500 per page the peak rose 9 MB (2,000 per page: 31 MB), and the whole scan took the same time.

## WRONG
```python
episodes = plex.query(f"/library/sections/{key}/all?type=4&excludeElements=Role,Director,Writer,Genre")
for item in episodes:  # all 12,738 parsed at once: +190 MB peak
    tally(item)
```

## RIGHT
```python
def paged(plex, path, size=500):
    start = 0
    while True:
        items = list(plex.query(f"{path}&X-Plex-Container-Start={start}&X-Plex-Container-Size={size}"))
        yield from items
        if len(items) < size:
            return
        start += size

for item in paged(plex, f"/library/sections/{key}/all?type=4&excludeElements=Role,Director,Writer,Genre,Country,Image"):
    tally(item)  # keep a small record per finding, not the elements: +9 MB peak, same speed
```

## NOTES
- Measured on lancelot 2026-09-28 (Plex 1.43.4, plexapi 4.18, Python 3.12 in Docker) with `resource.getrusage(...).ru_maxrss`, each size in a fresh process, since the peak only ever grows.
- plexapi's `section.all()` and `section.search()` page by `X-Plex-Container-Size` too (container_size), but return every item as a full object; for a scan, query the raw path and keep only what you need.
- Related: [plexapi `fetchItems` pages at 100 and resends the whole key list on every page](fetchitems-pages-repeat-key-list.md).
