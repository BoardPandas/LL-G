---
tech: northflank
tags: [api, endpoints, services, vcs, git, ci-cd, patch]
severity: medium
---
# Several v1 list paths differ from the docs, and a service PATCH needs the service TYPE in the path

## PROBLEM

Two unrelated traps that both cost time:

1. **A few obvious/documented list paths 404.** The plural/nested forms you would guess
   (`/billing/plans`, `/addons/types`, `/integrations`) are not the real routes.

2. **Partial-updating a service requires the service *type* in the path.** `PATCH` on the
   bare `/services/{id}` returns **405**, and so does `PATCH .../build-options`. It is easy
   to read those two 405s as "the API has no partial update for services" and fall back to a
   full-replace `PUT` (which forces you to restate ports, plans and health checks, and drops
   anything you forget) or to the dashboard. A typed `PATCH` does exist and does work:
   `/services/combined/{id}`, `/services/build/{id}`.

## WRONG

```text
GET   /v1/billing/plans                                 -> 404   (plan list)
GET   /v1/addons/types                                  -> 404   (addon types)
GET   /v1/integrations                                  -> 404   (VCS integrations)
GET   /v1/projects/{p}/services/{s}/builds              -> 404   (build history; note plural)

PATCH /v1/projects/{p}/services/{s}         {vcsData:{...}}   -> 405   (no type segment)
PATCH /v1/projects/{p}/services/{s}/build-options {vcsData:{...}} -> 405
        # wrong verb (it is POST), AND build-options never accepts vcsData
```

## RIGHT

```text
GET   /v1/plans                        (resource/compute plans)
GET   /v1/addon-types                  (addon types + versions)
GET   /v1/integrations/vcs             (linked GitHub/GitLab/Bitbucket accounts)
GET   /v1/integrations/vcs/repos       (every repo, tagged with its vcsLinkId/accountLogin)
GET   /v1/integrations/registries      (container registries)
GET   /v1/projects/{p}/services/{s}/build     (build history -- SINGULAR)

# Partial-update a service: put the service TYPE in the path.
PATCH /v1/projects/{p}/services/combined/{s}
{ "vcsData": { "projectUrl": "...", "projectType": "github",
               "projectBranch": "main", "accountLogin": "...", "vcsLinkId": "..." } }

PATCH /v1/projects/{p}/services/build/{s}
{ "vcsData": { "projectUrl": "...", "projectType": "github", "accountLogin": "..." } }
# NB: the build-service vcsData schema does NOT document projectBranch (combined does).

# Omitted fields keep their current values -- ports, plans, health checks and build
# settings survive, which is the whole reason to prefer this over a full PUT.
```

## NOTES

- **`build-options` is deprecated**, and is a `POST`, not a `PATCH`: *"This endpoint is
  deprecated and will be removed in the future."* Its body covers build engine / buildpack /
  branch + PR restrictions — **never `vcsData`**. The docs redirect you to the typed PATCH.
- **`POST .../build-source`** does accept `projectUrl`/`projectType`/`projectBranch`/
  `accountLogin`, but is **also deprecated**. Prefer the typed PATCH.
- **Verified**: a `PATCH /services/combined/{id}` carrying `vcsData` returns 200 and rebinds
  the repo + linked account, leaving the rest of the service intact. Not exercised: an actual
  *branch change* (the call under test re-sent the same branch), so if you are switching
  branches on a combined service, confirm the new branch took before relying on it.
- **The rebind triggers a build immediately.** Expect a rebuild and rolling redeploy the
  moment the PATCH lands — harmless when the tracked branch is unchanged, but not inert.
- `accountLogin` is an **override**, not a hint. The docs: if it is omitted Northflank
  "will pick a linked account that has access to the repository"; if it is supplied it uses
  *that* account and nothing else. So a stale explicit `accountLogin` actively defeats the
  auto-selection that would otherwise have healed it — see
  [org-transfer-stale-account-login.md](org-transfer-stale-account-login.md).
- Changing the tracked branch in the dashboard (Build settings) is still the zero-risk
  option. CI/CD is on by default (`disabledCI`/`disabledCD` are `false`), so a push to the
  tracked branch auto-builds + deploys. A branch change alone may not trigger a build --
  `POST /v1/projects/{p}/services/{s}/build` to kick one immediately.
