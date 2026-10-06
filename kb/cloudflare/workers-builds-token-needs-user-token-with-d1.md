---
tech: cloudflare
tags: [workers-builds, d1, api-token, ci]
severity: high
---
# Workers Builds' auto-generated token cannot touch D1, and the dashboard cannot select an existing token

## PROBLEM
A Worker whose Builds deploy command migrates D1 fails on the first build with the auto-generated 'Workers Builds - <date>' token, because it lacks D1 Edit. Creating a better token is not enough: account-owned tokens never appear in the Builds dropdown, and the dropdown has no option to paste an existing token value -- only 'Create new token' or tokens already registered with Builds. Read the trigger with `GET /builds/workers/{script_tag}/triggers`: `build_token_name` reveals which token is really selected.

## WRONG
```bash
# Builds UI: API token -> 'Workers Builds - 2026-04-09' (auto, no D1)
# deploy command: pnpm db:migrate:remote && npx wrangler deploy   -> fails on D1
```

## RIGHT
```bash
# 1. user token (My Profile -> API Tokens): Workers Scripts Edit, D1 Edit, Account Settings Read,
#    User Details Read, Memberships Read (+ Zone Workers Routes Edit for custom domains)
# 2. register it with Builds
id=$(curl -s -H "Authorization: Bearer $TOKEN" $API/user/tokens/verify | jq -r .result.id)
jq -n --arg s "$TOKEN" --arg id "$id" '{build_token_name:"app-builds",build_token_secret:$s,cloudflare_token_id:$id}' |
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data-binary @- $API/accounts/$ACCT/builds/tokens
# 3. select 'app-builds' in the dropdown; verify via GET .../builds/workers/$TAG/triggers
```

## NOTES
Editing a user token's permissions keeps its value, so a stored secret survives. Also see workers-builds-create-via-triggers.md.
