---
tech: northflank
tags: [api, projects, services, addons, plans, regions, validation]
severity: medium
---
# Resource-create validation: region/plan IDs, required buildSettings, description charset

## PROBLEM
Several create endpoints reject bodies that look correct against the generic docs,
because IDs and constraints are account/cluster-specific and undocumented in the
quickstart. You get repeated opaque 400s/404s until each field is exactly right.

## WRONG
```jsonc
// POST /v1/projects/{p}/services/combined  -- 400s several times
{ "name": "app",
  "billing": { "deploymentPlan": "nf-compute-100", "buildPlan": "nf-compute-200" },
  "description": "Dashboard + gateway",
  "vcsData": { "projectBranch": "main", "dockerFilePath": "/Dockerfile" },
  "ports": [ ... ] }
```

## RIGHT
```jsonc
{ "name": "app",
  "billing": { "deploymentPlan": "nf-compute-100-2" },
  "description": "Dashboard and gateway",
  "vcsData": { "projectUrl": "https://github.com/org/repo", "projectType": "github", "projectBranch": "main" },
  "buildSettings": { "buildEngine": "kaniko", "dockerfile": { "dockerFilePath": "/Dockerfile", "dockerWorkDir": "/" } },
  "ports": [ { "name": "p01", "internalPort": 3000, "public": true, "protocol": "HTTP" } ] }
```

## NOTES
- **Region IDs are cluster-specific**: `us-east1`, not the generic `us-east`. An
  unknown region returns **404**, not 400. Read an existing project (`GET /projects/{id}`)
  for the exact `deployment.region`.
- **Plan IDs are `nf-compute-<cpu>-<ram>`** (e.g. `nf-compute-100-2`); a bare
  `nf-compute-100` returns "Deployment plan not found". List valid plans at `GET /v1/plans`.
- **Combined services REQUIRE `buildSettings`**; `buildPlan` is not a valid `billing`
  key on combined create (returns "Build plan not found").
- **`description`** is validated against `/^[a-zA-Z0-9.,?\s\\/'"()[\];%^&*\-_:!]+$/`
  -- a `+` (and other unlisted symbols) fails it.
- **Addon Postgres**: storageClass is `nvme` (not `ssd`); mirror an existing addon's
  `storageSize`/`planId` (`GET /projects/{id}/addons/{addonId}`).
