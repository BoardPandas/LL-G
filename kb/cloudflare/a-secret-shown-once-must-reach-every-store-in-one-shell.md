---
tech: cloudflare
tags: [cloudflare, api-token, service-token, secret, github-secrets, doppler, rotation, shown-once]
severity: high
---
# A secret shown once must reach every store in one shell

## PROBLEM
Cloudflare shows a service token's Client Secret, or an API token's value, exactly once, at creation. GitHub secrets are write-only, so once a value is stored there it cannot be read back to copy elsewhere. A value written only to GitHub is stranded for any other consumer, such as Doppler for local and runtime use. Recovering it means rotating the credential, which invalidates the working copy and forces a second round of changes everywhere that used it.

## WRONG
```bash
# Stores the value in GitHub and prints it into the transcript; Doppler never receives it
out=$(cf-api create-service-token)
echo "$out"
gh secret set CF_ACCESS_CLIENT_SECRET --env production --body "$(echo "$out" | jq -r .result.client_secret)"
```

## RIGHT
```bash
bash -c '
  set -euo pipefail
  out=$(cf-api create-service-token)           # the response is captured, never printed
  sec=$(jq -r ".result.client_secret" <<< "$out")
  [ -n "$sec" ] || exit 1                       # refuse to store an empty value
  printf %s "$sec" | doppler secrets set CF_ACCESS_CLIENT_SECRET -p roundtable -c prd --no-interactive >/dev/null
  printf %s "$sec" | gh secret set CF_ACCESS_CLIENT_SECRET --env production
'
```

## NOTES
Write every destination in the same shell invocation, and validate non-empty before the first store. Never echo the value, and discard `doppler` stdout. If a store fails after creation, the value is lost and the credential must be rotated. Related: the realtime TURN key entry in the cloudflare shelf covers the same return-once behaviour on a different API, but not the multi-store step.
