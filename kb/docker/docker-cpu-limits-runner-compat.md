---
tech: docker
tags: [docker-compose, resource-limits, runner-compatibility, hosting-drift]
severity: medium
---
# Docker CPU limits must match the host runner's available CPUs

## PROBLEM
Image that compiles locally with 4 CPUs fails on hosted runner with 2 CPUs. Container refuses to start. Building on more CPUs than the runner has causes silent failure not reproducible at home.

## WRONG
```yaml
services:
  smoke:
    deploy:
      resources:
        limits:
          cpus: '4'  # But runner only has 2
```

## RIGHT
```yaml
services:
  smoke:
    deploy:
      resources:
        limits:
          cpus: '2'  # Match runner's exposed count
```

Check before deploying:

```bash
docker info | grep CPUs
docker run --cpus='2' busybox nproc
```

## NOTES
Hosted runners vary in CPU count. Building locally on more CPUs then deploying to fewer causes silent failure. Test resource limits against 2-CPU hosts in regression tests. Read `docker info` on the runner to know true exposed count.
