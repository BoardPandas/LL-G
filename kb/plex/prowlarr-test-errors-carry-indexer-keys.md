---
tech: plex
tags: [prowlarr, servarr, indexers, api, secrets, error-messages]
severity: high
---
# Prowlarr's indexer test errors can carry the indexer's URL and API key

## PROBLEM
Testing an indexer the way Prowlarr's own page does (GET `/api/v1/indexer/{id}`, then POST that resource to `/api/v1/indexer/test`) answers 400 on failure with a list of `{"propertyName", "errorMessage"}`. The messages are written for Prowlarr's own UI, which only the admin sees, and can include the request Prowlarr made to the indexer, for a newznab indexer something like `https://api.indexer.example/api?t=caps&apikey=...`. Passing `errorMessage` straight to a dashboard, a log line, or a notification leaks the indexer's API key (often a paid account's). It is silent: the message looks like a helpful error.

## WRONG
```python
answer = await client.post(f"{url}/api/v1/indexer/test", headers=key, json=indexer)
if answer.status_code == 400:
    raise HTTPException(502, detail=answer.json()[0]["errorMessage"])  # may hold the indexer's apikey
```

## RIGHT
```python
import re
URL = re.compile(r"https?://\S+")

answer = await client.post(f"{url}/api/v1/indexer/test", headers=key, json=indexer)
if answer.status_code == 400:
    messages = [m.get("errorMessage", "") for m in answer.json() if isinstance(m, dict)]
    reason = URL.sub("(link)", "; ".join(m for m in messages if m) or "no reason given")
    raise HTTPException(502, detail=f"The test failed: {reason}")
```

## NOTES
- The GET of the indexer resource itself also carries its secrets in `fields` (apiKey, cookies); send it back to Prowlarr as is, never show or log it.
- Prowlarr's other writes from its own page: switching one indexer is `PUT /api/v1/indexer/bulk` with `{"ids": [id], "enable": bool}`; syncing the apps is `POST /api/v1/command` with `{"name": "ApplicationIndexerSync", "forceSync": true}`.
- Read from Prowlarr 2.6.5's UI bundle (`/app/prowlarr/bin/UI/*.js`) on 2026-09-29, building PlexDash 0.72.0.
