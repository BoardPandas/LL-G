---
tech: python
tags: [httpx, redirects, raise_for_status, health-checks]
severity: medium
---
# httpx raise_for_status fails on redirects unless the client follows them

## PROBLEM
httpx does not follow redirects by default, and `Response.raise_for_status()` raises `HTTPStatusError` for a 3xx. A health check against a URL that redirects (a web UI root, a trailing-slash path) reports the service as down even though it is up. requests follows redirects by default, so ported code breaks.

## WRONG
```python
async with httpx.AsyncClient(timeout=5) as client:
    (await client.get(url)).raise_for_status()
```

## RIGHT
```python
async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
    (await client.get(url)).raise_for_status()
```
