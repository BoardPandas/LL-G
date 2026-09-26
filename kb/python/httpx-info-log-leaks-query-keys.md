---
tech: python
tags: [httpx, logging, secrets, api-keys]
severity: high
---
# httpx logs every request URL, query string included, at INFO

## PROBLEM
httpx's `httpx` logger emits `HTTP Request: GET http://host/api?apikey=... "HTTP/1.1 200 OK"` at INFO for every request. An app that configures the root logger at INFO or DEBUG writes every key sent as a query parameter (Tautulli, SABnzbd, many *arr-style APIs) into its log and container output. Nothing fails; it was found only by reading the output of a render script.

## WRONG
```python
logging.basicConfig(level=logging.DEBUG)
httpx.get(f"{url}/api/v2", params={"cmd": "status", "apikey": key})
```

## RIGHT
```python
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

def test_no_key_reaches_the_log(caplog):
    with caplog.at_level(logging.DEBUG):
        run_checks()
    assert caplog.records and KEY not in caplog.text
```

## NOTES
Prefer header auth where the API allows it. Related: requests-exception-leaks-url-secrets.md.
