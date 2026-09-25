---
tech: plex
tags: [plex, openapi, python-plexapi, codegen]
severity: medium
---
# Plex's official OpenAPI spec omits /library/metadata/{ids}/children

## PROBLEM
The official Plex Media Server spec (developer.plex.tv/pms, OpenAPI 3.1, 260 operations) has no `GET /library/metadata/{ids}/children`, yet python-plexapi uses it for `show.seasons()` and `season.episodes()`. A client generated from the spec, or an audit that treats the spec as the full API surface, misses an endpoint real clients depend on. It also documents section listing as `/library/sections/all` while plexapi calls `/library/sections`.

## WRONG
```python
# Treat the spec as the complete API
ops = {(m, p) for p, it in spec['paths'].items() for m in it}
assert ('get', '/library/metadata/{ids}/children') in ops  # fails: not in the spec
```

## RIGHT
```python
# Keep python-plexapi (or hand-written calls) for Plex; use the spec as a
# reference, and record the endpoints your client uses that the spec lacks.
seasons = show.seasons()        # GET /library/metadata/{id}/children
episodes = season.episodes()    # same endpoint, one level down
```

## NOTES
Checked against spec v1.2.3 (fetched 2026-09-25) and PMS 1.43.4.
