---
tech: northflank
tags: [api, endpoints, services, vcs, git, ci-cd]
severity: medium
---
# Several v1 list paths differ from the docs, and you can't PATCH a service's git branch

## PROBLEM
A few obvious/documented endpoint paths 404, and there is no partial-update endpoint
for an existing service's VCS branch -- so naive PATCH attempts return 405 and waste
time.

## WRONG
```text
GET   /v1/billing/plans                                  -> 404   (plan list)
GET   /v1/addons/types                                   -> 404   (addon types)
GET   /v1/integrations                                   -> 404   (VCS integrations)
PATCH /v1/projects/{p}/services/{s}/build-options  {vcsData:{projectBranch:"main"}}  -> 405
PATCH /v1/projects/{p}/services/{s}                 {vcsData:{...}}                    -> 405
```

## RIGHT
```text
GET   /v1/plans                     (resource/compute plans)
GET   /v1/addon-types               (addon types + versions)
GET   /v1/integrations/vcs          (linked GitHub/GitLab/Bitbucket accounts)
GET   /v1/integrations/registries   (container registries)

# To change a service's git branch: full-replace PUT /v1/projects/{p}/services/{s}
# (send the COMPLETE build spec, incl. ports so the domain mapping survives), or
# change it in the dashboard. `build-options` is a DEPRECATED POST and does not
# accept vcsData.
```

## NOTES
Changing the tracked branch in the dashboard (Build settings) is the zero-risk
option. CI/CD is on by default (`disabledCI`/`disabledCD` are `false`), so a push to
the tracked branch auto-builds + deploys. A branch change alone may not trigger a
build -- `POST /v1/projects/{p}/services/{s}/build` to kick one immediately.
