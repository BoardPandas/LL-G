---
tech: railway
tags: [healthcheck, postgres, credential-rotation, deploy]
severity: high
---
# Health checks that never query the database let a wrong DB password deploy green

## PROBLEM
If a service's deploy health check never touches the database, a rotated or wrong DB password deploys green, and the failure surfaces only when users try to log in.
Front-end apps that connect lazily (or proxy another service's `/health`) pass every probe. A service that runs migrations at boot fails differently: it crash-loops, so the deploy hangs rather than going green. A "deep" health endpoint that returns HTTP 200 with `database.ok: false` also passes `curl -f`.

## WRONG
```bash
# after rotating the DB password
curl -fsS https://app.example.com/health   # 200, proves nothing about the DB
```

## RIGHT
```bash
# check the field, not the status code
curl -s https://api.example.com/v1/health | jq -e '.database.ok'
# then sign in to each lazily-connecting app by hand
```

## NOTES
After a credential rotation, treat a stuck deploy on the migrate-at-boot service as a bad DATABASE_URL. Better long-term: have the health endpoint return a non-2xx status when a required dependency is down.
