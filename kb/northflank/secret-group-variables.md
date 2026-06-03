---
tech: northflank
tags: [secrets, env, api, silent-failure]
severity: high
---
# Creating a secret group: variables go under secrets.variables, and priority is required

## PROBLEM
`POST /v1/projects/{id}/secrets` with a top-level `data: { KEY: VALUE }` returns
**200 and creates the group** -- but the variables are silently dropped, because the
real field is `secrets.variables`. Services that inherit the group then boot with an
empty environment and crash ("missing env var"). Separately, `priority` is required
on create even though many wrappers treat it as optional.

## WRONG
```jsonc
// 200 OK, but GET shows secrets.variables == {}  -> inheriting service crashes
{ "name": "app-secrets", "secretType": "environment",
  "data": { "DATABASE_URL": "postgres://..." } }
```

## RIGHT
```jsonc
{ "name": "app-secrets", "secretType": "environment", "priority": 10,
  "secrets": { "variables": { "DATABASE_URL": "postgres://..." }, "files": {} } }
```

## NOTES
An unrestricted group (`restrictions.restricted: false`) is inherited by every
service in the project automatically -- but only if `secrets.variables` is actually
populated. Verify with `GET /projects/{id}/secrets/{sid}` and check
`data.secrets.variables`. To update vars later, PATCH the same
`{ "secrets": { "variables": { ... } } }` shape.
