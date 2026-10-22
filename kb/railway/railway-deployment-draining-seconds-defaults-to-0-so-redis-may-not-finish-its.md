---
tech: railway
tags: [redis, draining, sigterm, persistence, rdb, bullmq]
severity: high
---
# RAILWAY_DEPLOYMENT_DRAINING_SECONDS defaults to 0, so Redis may not finish its SIGTERM save on redeploy

## PROBLEM
Railway's `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` defaults to 0, so the old container is killed right after SIGTERM and Redis may not complete its shutdown save.
Redis normally writes an RDB snapshot on SIGTERM, so a config change (e.g. adding a password) that redeploys Redis looks safe. With zero drain time, any writes since the last background save can be lost (queued jobs, sessions).

## WRONG
```text
Set REDIS_PASSWORD on the Redis service -> deploy -> trust the SIGTERM save
```

## RIGHT
```bash
# Before the Redis deploy, force a synchronous snapshot
redis-cli -u "$REDIS_URL" SAVE      # returns OK once the RDB is on disk
# and/or give the old container time to shut down cleanly
RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30   # on the Redis service
```

## NOTES
- Check the key count (`DBSIZE`) before and after the deploy.
- Related: nodejs/bullmq-redis-delayed-jobs-lost.
