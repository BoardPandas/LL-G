---
tech: docker
tags: [docker-compose, resource-limits, runner-compatibility, hosting-drift]
severity: medium
---
# Docker CPU limits must match the host runner's available CPUs

## PROBLEM
A Docker image that successfully compiles locally fails when the smoke test container is run on a hosted CI runner. The container declares a four-CPU limit in its compose configuration, but the hosted runner exposes only two CPUs to Docker. The same image passes on a development machine with more CPUs, which looks like the build succeeded, but the hosted workflow fails silently. Image validity does not prove runner compatibility. The CPU limit must be lower than the runner's actual capacity or the container refuses to start.

## WRONG
```yaml
# docker-compose.yml
services:
  smoke:
    image: tcg-smoke:latest
    deploy:
      resources:
        limits:
          cpus: '4'  # But the runner only has 2 CPUs
```

Image builds locally and passes on powerful hardware. CI runner with 2 CPUs rejects the container.

## RIGHT
```yaml
# docker-compose.yml
services:
  smoke:
    image: tcg-smoke:latest
    deploy:
      resources:
        limits:
          cpus: '2'  # Match the CI runner's exposed CPU count
```

Before setting CPU limits:

```bash
# On the hosted runner, check available CPUs
docker info | grep CPUs

# Smoke test in a Docker container that reports its own view
docker run --cpus='4' busybox nproc  # Might fail or report fewer CPUs
docker run --cpus='2' busybox nproc  # Succeeds, reports 2
```

## NOTES
The `cpus` limit in Docker Compose sets `--cpus` on the container, which Linux cgroups enforces; the limit cannot exceed the host machine's total. Automated hosted runners vary in CPU count—some expose 2, some 4, some 8. Building and testing locally on more CPUs then deploying to fewer causes a surprise failure that is not reproducible at home.

Test resource limits against simulated small Docker hosts in regression tests. Run the shell wrapper (deploy scripts, smoke tests, any scripted container execution) against Docker daemons with 2 CPUs available, then verify the real hosted workflow with the actual runner's CPU profile. A visible failure in a simulated low-resource environment catches the mismatch before it reaches production.

Read `docker info` after starting the runner's Docker daemon to know the true exposed count. Compose syntax before Docker Desktop 4.2 uses `version: 3` with a different resource structure; verify the syntax matches your Docker and Compose versions.
