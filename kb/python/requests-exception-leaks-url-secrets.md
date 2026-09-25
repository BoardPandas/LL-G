---
tech: python
tags: [requests, logging, secrets, exceptions]
severity: high
---
# requests puts the full URL, query string included, into its exception text

## PROBLEM
`requests` exceptions (ConnectionError, HTTPError, ReadTimeout) include the request URL in their message, with the query string. Logging them with `exc_info=True`, `%s`, or `str(exc)` around a call whose URL carries a secret (`?apikey=`, `?X-Plex-Token=`, a plex.tv PIN `code=`) writes that secret to the log. Nothing looks wrong: the log line is a normal error.

## WRONG
```python
try:
    requests.get(url, params={"code": pin_code}, timeout=10)
except requests.RequestException:
    log.warning("PIN check failed", exc_info=True)   # URL with code=... in the log
```

## RIGHT
```python
try:
    requests.get(url, params={"code": pin_code}, timeout=10)
except requests.RequestException as exc:
    log.warning("PIN check failed: %s", type(exc).__name__)
```

## NOTES
Prefer secrets in headers over query parameters. Add a test that captures logs (caplog) and asserts the secret never appears.
