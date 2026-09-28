---
tech: python
tags: [plex, plexapi, token, plex.tv, device, x-plex-headers]
severity: high
---
# Never give an app the Plex server's own token (PlexOnlineToken)

## PROBLEM
A Plex Media Server's own token (`PlexOnlineToken` in its `Preferences.xml`) authenticates as the owner, so it looks like an admin token to borrow. But plex.tv updates the device a token belongs to from each request's `X-Plex-*` headers. A client using the server's token (plexapi defaults: `X-Plex-Provides: controller`, `X-Plex-Device-Name: <hostname>`) rewrites the server's own registration into that client. Plex apps find the server through that record, so every Plex app loses the server. Nothing errors in the client; the breakage shows up only on other devices.

## WRONG
```python
# PLEX_TOKEN copied from the server's Preferences.xml (PlexOnlineToken)
plex = PlexServer(url, os.environ["PLEX_TOKEN"])
plex.myPlexAccount()  # plex.tv now records the server as a "controller" named after this host
```

## RIGHT
```python
# PLEX_TOKEN is a token issued to the app itself (a plex.tv PIN sign-in as the app).
import plexapi

# plexapi's modules import BASE_HEADERS by name: update the shared dict in place, never replace it.
plexapi.BASE_HEADERS.update({"X-Plex-Product": "MyApp", "X-Plex-Device-Name": "MyApp"})
plex = PlexServer(url, os.environ["PLEX_TOKEN"])
```

## NOTES
- Any borrowed token (e.g. from Plex Web) does the same to that device; give each app its own token.
- plexapi reads `PLEXAPI_HEADER_*` env vars only at import time.
- With host networking a container's hostname is the host's, which can equal the server's name.
- Recovery: put the app's own token in place, restart it, and have Plex Media Server register again.
