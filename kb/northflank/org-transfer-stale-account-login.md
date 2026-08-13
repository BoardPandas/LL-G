---
tech: northflank
tags: [vcs, github, org-transfer, auto-deploy, ci-cd, accountLogin, build-source, webhook]
severity: high
---
# Transferring a repo between GitHub orgs leaves accountLogin stale, silently breaking auto-deploy

## PROBLEM

When a repo is transferred (or its org renamed) on GitHub, a Northflank service's
`vcsData` ends up **half-updated**:

- `vcsData.projectUrl` shows the **new** URL. GitHub serves a permanent redirect for
  the old path, so this field reads as correct.
- `vcsData.accountLogin` still names the **old** linked VCS account, whose GitHub App
  installation no longer has access to the repo.

The service object is therefore self-consistent to a human reading it — the repo URL is
right, `disabledCI` is `false`, the last build is `SUCCESS` — while the credential behind
it can no longer clone. There is no warning, no degraded status, and no failed build to
look at, because **nothing runs until the next push**. If the transfer happens on a quiet
day the gap can be days long, and when it finally breaks it presents as a webhook or CI
fault rather than a stale account binding.

`git clone`, `git fetch`, and `gh repo view` all keep working against the old path via the
redirect, so the usual local checks confirm the wrong conclusion.

The authoritative check is `GET /v1/integrations/vcs/repos`, which returns every repo the
account can actually see, each tagged with its owning `vcsLinkId` / `accountLogin`. If the
repo is not listed under the `accountLogin` the service names, that service cannot clone it.

## WRONG

```bash
# Reading the service and concluding the move is done, because the URL looks right.
northflank_get_service --projectId p --serviceId s
# vcsData.projectUrl:   https://github.com/NewOrg/MCP   <- correct, and reassuring
# vcsData.accountLogin: OldOrg                          <- stale, and fatal

# Confirming with git, which follows GitHub's redirect and always succeeds:
git fetch origin && echo "repo fine, deploy must be fine"

# Trying to fix it through the endpoint most docs point at:
curl -X PATCH .../v1/projects/p/services/s/build-options -d '{"vcsData": {...}}'
# 405 Method Not Allowed -- that route is POST-only AND carries no vcsData at all.
```

## RIGHT

```bash
# 1. Ask which linked account can actually see the repo.
#    Returns every repo with its vcsLinkId + accountLogin.
GET /v1/integrations/vcs/repos

# Suppose it shows:
#   NewOrg/MCP        -> vcsLinkId 69a5e196...  accountLogin NewOrg
#   OldOrg/other-repo -> vcsLinkId 69a47ed2...  accountLogin OldOrg
# The service naming accountLogin=OldOrg cannot clone NewOrg/MCP.

# 2. Rebind. For a combined service the working route is a PATCH on the
#    TYPED path (.../services/combined/{id}), not the bare service path.
#    vcsLinkId is accepted directly and is less ambiguous than accountLogin alone.
PATCH /v1/projects/{projectId}/services/combined/{serviceId}
{
  "vcsData": {
    "projectUrl":    "https://github.com/NewOrg/MCP",
    "projectType":   "github",
    "projectBranch": "main",
    "accountLogin":  "NewOrg",
    "vcsLinkId":     "69a5e19632652b8ab9d4322d"
  }
}
# PATCH preserves untouched settings (ports, plans, health checks, build settings).

# 3. Verify with a REAL push, not a config read-back. Confirm a build is
#    auto-created for the pushed SHA -- that is what proves the webhook binding,
#    which the service object cannot tell you.
git push origin main
GET /v1/projects/{p}/services/{s}/build   # newest build .sha == the SHA you pushed
```

## NOTES

- **The rebind itself triggers a build.** Expect a rebuild + rolling redeploy the moment
  you PATCH. Harmless when `main` is unchanged (it rebuilds the SHA already live), but do
  not run it mid-incident assuming it is inert.
- **Two distinct verifications.** A build succeeding after the PATCH proves the new link
  can *clone*. Only a build auto-created by an actual `git push` proves the *webhook*
  fires from the new org. Check both; they can fail independently.
- **Endpoint corrections** (docs and LLM recall are both unreliable here):
  - `PATCH .../services/{id}/build-options` → 405. The real route is **POST**, and its
    body covers build engine / buildpack / branch restrictions — **no `vcsData`**.
  - `POST .../services/{id}/build-source` accepts `projectUrl`/`projectType`/
    `projectBranch`/`accountLogin`, but is **deprecated** in favour of the typed PATCH above.
  - `GET .../services/{id}/build` lists builds; `.../builds` (plural) is 404.
- **Supersedes part of [api-endpoint-paths.md](api-endpoint-paths.md)**, which states you
  cannot PATCH a service's git branch and must use a full PUT or the dashboard. The typed
  `PATCH /services/combined/{id}` with a `vcsData` block does work, and is safer than PUT
  because it does not require restating the whole service.
- The old VCS account link usually survives the transfer and keeps serving whatever repos
  stayed behind, so it looks healthy in the integrations list. Its presence is not evidence
  that any particular service is correctly bound.
- Same failure shape applies to a plain **org rename** and to moving a repo between two
  orgs you own — anything that changes the repo's owner while GitHub keeps a redirect alive.
