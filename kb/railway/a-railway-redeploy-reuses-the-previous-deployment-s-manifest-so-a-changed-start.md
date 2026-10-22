---
tech: railway
tags: [redeploy, start-command, serviceInstanceRedeploy, serviceInstanceDeployV2, mcp]
severity: high
---
# A Railway redeploy reuses the previous deployment's manifest, so a changed start command is not applied

## PROBLEM
A Railway redeploy (MCP `redeploy`, GraphQL `serviceInstanceRedeploy`) copies the previous deployment's service manifest, so a start command (or other service setting) changed since then is silently NOT applied.
Variables ARE re-resolved on a redeploy, so the new deployment looks fresh: new env values show up, the deploy succeeds, and nothing says the start command is the old one. You only notice when the process behaves as before (e.g. a wrapper you added to the start command never runs).

## WRONG
```text
1. update-service  startCommand: "node scripts/start.mjs"
2. redeploy        (MCP)  /  serviceInstanceRedeploy (API)
3. Deploy goes green, new env vars visible -> assume new start command is live
```

## RIGHT
```graphql
# Deploy from current service config (same as the dashboard "Deploy" button)
mutation { serviceInstanceDeployV2(serviceId: "<service-id>", environmentId: "<env-id>") }

# Then verify what the deployment actually ran with
query { deployment(id: "<deployment-id>") { meta } }
# check meta.serviceManifest.deploy.startCommand matches the new value
```

## NOTES
- Treat "redeploy" as "re-run the last deployment with fresh variables", not "deploy current settings".
- Always confirm a settings change via `deployment.meta.serviceManifest`, never via the update call's echo (see railway/update-service-updatedfields-echoes-request).
