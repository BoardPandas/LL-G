---
tech: northflank
tags: [rbac, permissions, api-token, logs, metrics, observability, owner-role, 401]
severity: high
---
# Service logs/metrics API needs ps_services_deployment_view-observability, which the immutable Owner role lacks

## PROBLEM
The per-service observability REST endpoints — `GET /v1/projects/{projectId}/services/{serviceId}/logs`, `/build-logs`, and `/metrics` — are gated by the project permission `ps_services_deployment_view-observability` ("Project > Services > Deployment > View Observability", which the API docs label "View Instance Logs"). This is a DIFFERENT permission from `ps_observability_logs_read` ("Observability > Logs > Read"). Having "Observability > Logs > Read" (and "Metrics > Read") checked on the role does NOT authorize these endpoints; the call returns 401 with `requiredPermission: "ps_services_deployment_view-observability"`.

Worse: the built-in **Owner** role is immutable AND does not include `view-observability`, so even an unrestricted Owner-role API token 401s on logs/metrics. Trying to patch it (`PATCH /v1/teams/{team}/roles/owner`) returns `409 "Cannot modify owner role"` (PUT is 405). The built-in **SuperAPI** role DOES include it. It's confusing because the role editor shows "Observability > Logs/Metrics > Read" checked, so it looks like logs access is granted when it is not.

## WRONG
```bash
# Token on the "Owner" role (or any role with only ps_observability_logs_read).
# GET service succeeds, but logs 401 -> looks like a bad endpoint or token.
curl -H "Authorization: Bearer $OWNER_TOKEN" \
  https://api.northflank.com/v1/projects/bts/services/bts-api          # 200 OK
curl -H "Authorization: Bearer $OWNER_TOKEN" \
  https://api.northflank.com/v1/projects/bts/services/bts-api/logs
# 401 {"error":{"message":"...does not have permission...",
#       "details":{"requiredPermission":"ps_services_deployment_view-observability"}}}

# Trying to add it to Owner fails — Owner is a frozen system role:
curl -X PATCH -H "Authorization: Bearer $OWNER_TOKEN" \
  -d '{...}' https://api.northflank.com/v1/teams/$TEAM/roles/owner
# 409 {"error":{"message":"Cannot modify owner role"}}
```

## RIGHT
```bash
# Use a token whose role includes ps_services_deployment_view-observability.
# The built-in SuperAPI role has it; an Owner token does not.
curl -H "Authorization: Bearer $SUPERAPI_TOKEN" \
  https://api.northflank.com/v1/projects/bts/services/bts-api/logs?logType=runtime
# 200 OK -> {"data":[{ "log":"...", "ts":"..." }, ...]}

# Or create a CUSTOM role that includes the three deployment view-observability
# perms (jobs/addons variants are needed for job and addon logs):
#   ps_services_deployment_view-observability
#   ps_jobs_deployment_view-observability
#   ps_addons_deployment_view-observability
# Inspect a role's exact perms (token needs Roles>Read); they come back as flat
# string arrays under permissions.teamScope / permissions.projectScope:
curl -H "Authorization: Bearer $TOKEN" \
  https://api.northflank.com/v1/teams/$TEAM/roles/owner   # GET; list at /roles
```

## NOTES
- Diagnostic tell: a 200 on `GET .../services/{serviceId}` while `GET .../logs` 401s means it is this specific observability permission, not a wrong endpoint or a bad token. The endpoint itself is correct per the docs (https://northflank.com/docs/v1/api/project/services/get-service-logs) and has no required query params.
- Decode the `nf-...` JWT payload (base64 the middle segment) to read `roleInternalId` — `owner` vs `superapi` tells you immediately whether logs will work.
- This is also why a hosted MCP/bridge that proxies Northflank can read services but 401 on logs: the stored API token is on the wrong role, not a bridge bug.
- Related: the northflank entry on errors nesting under `{ error: { message, details } }` — that envelope is how `requiredPermission` is surfaced.
