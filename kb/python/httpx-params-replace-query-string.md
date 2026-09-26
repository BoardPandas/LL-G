---
tech: python
tags: [httpx, query-string, params, requests]
severity: medium
---
# httpx replaces a URL's query string when params are passed

## PROBLEM
`requests` merges `params=` into a query string already in the URL. httpx (0.28) replaces it: `client.get("/api?mode=version&output=json", params={"apikey": k})` sends only `?apikey=k`. The server answers with an error that names a missing parameter (SABnzbd: "not implemented"; Tautulli: "Parameter cmd is required"), which looks like a wrong key or a wrong endpoint.

## WRONG
```python
client.get(f"{url}/api?mode=version&output=json", params={"apikey": key})
```

## RIGHT
```python
client.get(f"{url}/api", params={"mode": "version", "output": "json", "apikey": key})
```

## NOTES
Check with `httpx.Request("GET", url, params=...).url`. Common when porting code from requests.
