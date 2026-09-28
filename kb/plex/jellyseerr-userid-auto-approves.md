---
tech: plex
tags: [jellyseerr, overseerr, seerr, api, permissions, auto-approve, requests]
severity: high
---
# Jellyseerr auto-approves a request filed with the admin key and a userId

## PROBLEM
Seerr (Jellyseerr, Overseerr) `POST /api/v1/request` takes a `userId` in the body so an admin API key can file a request for another user, and the permission and quota checks then use that user. But auto-approve is decided from `req.user`, the account the call itself acts as, which for an API key is the admin (user 1), not from `userId` (Seerr 3.4.1 `server/entity/MediaRequest.ts`: status uses `user.hasPermission([AUTO_APPROVE, AUTO_APPROVE_MOVIE/TV, MANAGE_REQUESTS])`). Every request filed that way is approved at once and sent to Radarr or Sonarr, skipping the owner's approval. It is silent: the request looks correctly attributed.

## WRONG
```python
await client.post(f"{url}/api/v1/request",
                  headers={"X-Api-Key": key},
                  json={"mediaType": "movie", "mediaId": tmdb_id, "userId": member_id})
```

## RIGHT
```python
# Seerr's API-key sign-in honors X-API-User (server/middleware/auth.ts; default user 1):
# the call then acts fully as that user, so their permissions, auto-approve, and quota apply
response = await client.post(f"{url}/api/v1/request",
                             headers={"X-Api-Key": key, "X-API-User": str(member_id)},
                             json={"mediaType": "movie", "mediaId": tmdb_id, "is4k": False})
if response.status_code == 202:  # "No seasons available to request": nothing was filed
    raise NothingLeft()
response.raise_for_status()
```

## NOTES
- `X-API-User` is not in the OpenAPI spec. Never send `ignoreQuota`.
- Seerr answers 202, not an error, when every season asked for is already taken, so check the status code, not only `raise_for_status()`.
- `serverId`, `profileId`, and `rootFolder` in the body are accepted from any user; only the web UI hides Advanced from accounts without REQUEST_ADVANCED, MANAGE_REQUESTS, or ADMIN. Enforce that yourself.
- Verified by reading Seerr source at commit 69f73a6 (3.4.1); no request was filed to test it.
