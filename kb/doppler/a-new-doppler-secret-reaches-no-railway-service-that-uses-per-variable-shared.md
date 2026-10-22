---
tech: doppler
tags: [railway, shared-variables, sync, reference, deploy-order]
severity: high
---
# A new Doppler secret reaches no Railway service that uses per-variable shared references until you add the reference first

## PROBLEM
When Doppler syncs to Railway shared variables and each service references them one by one (`${{shared.NAME}}`), a brand-new Doppler secret lands in shared variables but reaches no service until a reference is added to that service.
The Doppler write still triggers a deploy, so the deploy runs green without the variable; the app falls back to a default or fails at first use. Adding the reference afterwards needs yet another deploy.

## WRONG
```text
1. Add NEW_SECRET in Doppler -> sync -> deploy (service has no ${{shared.NEW_SECRET}})
2. Notice the app lacks it, add the reference -> second deploy
```

## RIGHT
```text
1. On each consuming service, add NEW_SECRET=${{shared.NEW_SECRET}}
   with deploys skipped (stage the change, do not deploy)
2. Add NEW_SECRET in Doppler -> sync -> the one deploy resolves the reference
3. Verify the variable is present on the new deployment
```

## NOTES
- Applies only to services that reference shared variables individually.
- Related: doppler/doppler-silently-disables-a-railway-sync-when-railway-rejects-its-token-so-prd.
