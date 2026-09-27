---
tech: plex
tags: [plex, python-plexapi, fetchItems, ratingKey, batch, silent-failure]
severity: high
---
# plexapi `fetchItems([keys])` silently leaves out keys the server no longer has

## PROBLEM
`plex.fetchItem(key)` raises `NotFound` for a rating key that no longer exists, but `plex.fetchItems([k1, k2, ...])`, which requests `/library/metadata/k1,k2,...`, just returns the items it found. Code that replaces a loop of `fetchItem` calls with one `fetchItems` call, then pairs the results with the keys by position, misaligns every item after the first missing key, with no error. Verified with python-plexapi 4.18.0 against a live Plex Media Server: 11 keys, one of them gone, returned 10 items.

## WRONG
```python
episodes = plex.fetchItems(rating_keys)
for key, episode in zip(rating_keys, episodes):  # shifts by one after the first missing key
    titles[key] = episode.title
```

## RIGHT
```python
found = {item.ratingKey: item for item in plex.fetchItems(rating_keys)}
episodes = [found[key] for key in rating_keys if key in found]  # requested order, missing keys left out
missing = len(rating_keys) - len(episodes)
```

## NOTES
- In testing the items came back in request order, but nothing documents that; map by `ratingKey`.
- Batch long key lists: [fetchitems-pages-repeat-key-list.md](fetchitems-pages-repeat-key-list.md).
