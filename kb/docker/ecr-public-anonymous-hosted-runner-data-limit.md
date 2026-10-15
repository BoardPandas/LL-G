---
tech: docker
tags: [github-actions, ci, ecr-public, docker-hub, registry, rate-limits, image-mirrors]
severity: medium
---
# ECR Public also rate-limits anonymous hosted-runner image pulls

## PROBLEM

Moving CI service images from Docker Hub to Docker's official ECR Public mirror
avoids a particular Docker Hub pull limit, but does not make anonymous pulls
unlimited. Two fresh GitHub-hosted runners can both fail before checkout with
`toomanyrequests: Data limit exceeded` from `public.ecr.aws`.

GitHub initializes job service containers before running steps, so a retry,
login or registry change in a later step cannot recover that job. An identical
rerun only helps if the new runner can actually download the image. Read the
registry error and the failed step before changing application code or treating
the integration tests as failed assertions.

## WRONG

```yaml
services:
  postgres:
    # This registry also has anonymous limits; it is not a permanent exemption.
    image: public.ecr.aws/docker/library/postgres:18
steps:
  - run: docker login some-registry  # Never reached when service startup fails.
```

## RIGHT

Verify a trusted alternative serves the intended official image before switching
the service image. For example, Google's Docker Hub cache can serve the same
official image, but cache availability must be checked rather than assumed:

```bash
podman manifest inspect mirror.gcr.io/library/postgres:18 > mirror.json
podman manifest inspect docker.io/library/postgres:18 > upstream.json
# Compare the manifest digest for the runner's actual architecture in both files.
jq -r '.manifests[] | select(.platform.os == "linux" and
  .platform.architecture == "amd64") | .digest' mirror.json upstream.json
podman run --rm mirror.gcr.io/library/postgres:18 postgres --version
```

After verifying content identity and execution, update the service image and run
the same integration checks. Preserve the database major version, health checks,
ports, credentials and release dependencies. A successful local pull does not
prove the hosted runner can pull; confirm its Initialize containers step and the
test suite both pass.

## NOTES

- SupportForge switched from Docker Hub to ECR on 2026-10-09 after Hub limits,
  then two fresh ECR attempts failed on 2026-10-15 before tests ran. PostgreSQL 18
  and Redis 8 Alpine were available in Google's cache with matching Linux AMD64
  upstream digests, and the next hosted run initialized both containers.
- This is a bounded recovery, not a promise that a public cache is always
  available. For sustained volume, use an authenticated registry or a managed
  cache rather than assuming another anonymous mirror has no quota.
- Do not bypass test or deployment gates to recover from a registry failure.
- [Google's cache documentation](https://docs.cloud.google.com/artifact-registry/docs/pull-cached-dockerhub-images)
