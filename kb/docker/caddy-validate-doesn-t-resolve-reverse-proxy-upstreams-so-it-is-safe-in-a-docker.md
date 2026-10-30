---
tech: docker
tags: [caddy, caddyfile, railway, build, validation]
severity: low
---
# caddy validate doesn't resolve reverse_proxy upstreams, so it is safe in a Docker build

## PROBLEM
`caddy validate` provisions the config without dialing or resolving `reverse_proxy` upstreams, so it can gate a Docker build even when the upstream host, like `api.railway.internal`, exists only at runtime.
It's tempting to skip validation because the build can't reach the upstream. Then a Caddyfile typo ships, and the container crash-loops at start.

## WRONG
```dockerfile
FROM caddy:2.11-alpine
COPY Caddyfile /etc/caddy/Caddyfile
# no validation: a bad Caddyfile is found only when the new deploy crashes
```

## RIGHT
```dockerfile
FROM caddy:2.11-alpine
COPY Caddyfile /etc/caddy/Caddyfile
# A bad Caddyfile fails the build, so the running deploy stays up.
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

## NOTES
Verified with Caddy v2.11.7 and an upstream hostname that didn't resolve. `{$VAR:default}` placeholders take their defaults when the variable is unset at build time.
