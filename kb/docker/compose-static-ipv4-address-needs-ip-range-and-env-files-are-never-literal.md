---
tech: docker
tags: [docker-compose, ipv4-address, ip-range, ipam, static-ip, env-file, quoting, secrets, base64]
severity: medium
---
# docker compose: a fixed ipv4_address can be taken by a service that starts earlier unless ip_range reserves it, and no env-file quoting form is fully literal

## PROBLEM
Two compose behaviours that fail intermittently or only for certain values:

1. **Static address taken.** A service with a fixed `ipv4_address` on a user-defined network has no reservation. Dynamic addresses are handed out from the same subnet, so a service that starts earlier can be given exactly that address. The fixed-address service then cannot have its address, depending on start order.
2. **Env files are never literal.** No quoting form in a compose env file passes a value through untouched. Unquoted and double-quoted values are interpolated, and even inside single quotes `\'` is processed. A secret containing quotes, `$` or backslashes can arrive changed, with no error.

## WRONG
```yaml
networks:
  internal:
    ipam:
      config:
        - subnet: 172.28.0.0/24          # dynamic addresses come from the whole subnet
services:
  proxy:
    networks:
      internal:
        ipv4_address: 172.28.0.10        # may already belong to a service that started first
```
```bash
# .env
DB_PASSWORD='it\'s $ecret'               # not literal: \' is processed
```

## RIGHT
```yaml
networks:
  internal:
    ipam:
      config:
        - subnet: 172.28.0.0/24
          ip_range: 172.28.0.128/25      # dynamic addresses stay in the upper half
services:
  proxy:
    networks:
      internal:
        ipv4_address: 172.28.0.10        # static addresses live outside ip_range
```
```bash
# Pass secrets as exported shell variables decoded from base64 lines, not through an env file.
# Each input line: NAME=<base64 of the exact value>
while IFS= read -r line; do
  name=${line%%=*}; b64=${line#*=}      # not `IFS== read name b64`: that drops a trailing "=" of padding
  export "$name=$(printf '%s' "$b64" | base64 -d)"
done
docker compose up -d        # compose.yaml: environment: { DB_PASSWORD: "${DB_PASSWORD:?}" }
```

## NOTES
- base64 has no characters that any shell or env-file parser treats specially, so the value that arrives is the value that was sent.
- Prove the transport with awkward dummy values (quotes, `$`, backslashes, JSON) before sending a real secret.
- Related: `compose-exec-stdin-heredoc-drain.md` on this shelf, for commands that read the same stdin.
