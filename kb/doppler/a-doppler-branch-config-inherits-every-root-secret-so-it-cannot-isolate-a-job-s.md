---
tech: doppler
tags: [least-privilege, service-tokens, branch-configs, secrets]
severity: high
---
# A Doppler branch config inherits every root secret, so it cannot isolate a job's credentials

## PROBLEM
A branch config such as `prd_backup` inherits every secret of its root `prd` config, owner database credentials included, so a service token on it can read all of production.
It looks like isolation because it has its own name and token, and it inherits by design.

## WRONG
```bash
doppler configs create prd_backup -p app -e prd
doppler configs tokens create backup -p app -c prd_backup   # sees every prd secret
```

## RIGHT
```bash
# Separate project (or environment): no inheritance from prd
doppler projects create app-backup
doppler configs tokens create backup -p app-backup -c prd --plain
# Verify what the token can read, names only:
curl -sf --config - <<<'header = "Authorization: Bearer '"$TOKEN"'"
url = "https://api.doppler.com/v3/configs/config/secrets/download?format=json"' | jq 'keys'
```

## NOTES
Keep a decryption or restore key in yet another environment, so the job's token cannot read it.
