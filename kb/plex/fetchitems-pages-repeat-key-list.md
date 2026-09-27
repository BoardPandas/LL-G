---
tech: plex
tags: [plex, python-plexapi, fetchItems, paging, performance, X-Plex-Container-Size]
severity: medium
---
# plexapi `fetchItems` pages at 100 and resends the whole key list on every page

## PROBLEM
`fetchItems(keys)` turns a key list into `/library/metadata/k1,k2,...` and pages through the answer `X_PLEX_CONTAINER_SIZE` (default 100) items at a time, sending the same full URL with a new `X-Plex-Container-Start` header each time. The server resolves the whole list for every page, so the cost grows faster than the number of keys. Measured with python-plexapi 4.18.0 on a live Plex Media Server: 100 keys took 1 request and 0.11 s; 500 keys took 5 requests and 1.46 s, each with a 3 KB URL.

## WRONG
```python
episodes = plex.fetchItems(all_keys)  # 1,369 keys: 14 page requests, each resending all 1,369 keys
```

## RIGHT
```python
BATCH = 100
episodes = []
for start in range(0, len(all_keys), BATCH):
    episodes += plex.fetchItems(all_keys[start:start + BATCH], container_size=BATCH)  # one request per batch
```

## NOTES
- Same server, 1,369 episodes: one `fetchItem` per key took 1,369 requests and 7.4 s; batches of 100 took 14 requests and 1.9 s.
- Passing `container_size` equal to the batch keeps each batch to one request whatever `plexapi.container_size` is set to.
- A missing key is dropped without an error: [fetchitems-drops-missing-keys.md](fetchitems-drops-missing-keys.md).
