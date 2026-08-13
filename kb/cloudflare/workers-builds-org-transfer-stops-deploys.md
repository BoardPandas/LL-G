---
tech: cloudflare
tags: [workers-builds, deploy, ci, github, repo-transfer, silent-failure, provider-account]
severity: high
---
# Transferring a repo between GitHub orgs silently stops Workers Builds

## PROBLEM

Move a repo to a different GitHub org and Workers Builds stops deploying, with **no
signal of any kind**: no failed build, no queued build, no error in the dashboard or the
API. Builds simply stop being created. Pushes that used to produce a build within ~2
seconds produce nothing at all.

The stored repo connection pins **`provider_account_id`** -- the GitHub *owner* id. A
transfer changes the owner id while leaving `repo_id` untouched, so the connection still
resolves the repo but points at an installation that no longer has it. Push events never
arrive.

Two things actively disguise this:

1. **`git` keeps working.** GitHub serves a permanent redirect for the old path, so
   `git push`, `git ls-remote` and `gh repo view` all succeed against the stale URL. A
   remote that still resolves is not evidence the deploy pipeline is alive.
2. **It looks like nothing happened, because nothing did.** There is no failed build to
   find. If you go looking in build history you find the *last good* build and conclude
   things are fine.

Note this is a *transfer*, not a rename. On a rename the owner id is unchanged and
nothing breaks. Distinguish them by comparing owner ids, not names: if
`orgs/<old>` 404s but the repo's `owner.id` differs from the connection's
`provider_account_id`, it was a transfer between two distinct orgs.

## WRONG

```bash
# Repo moved from OldOrg -> NewOrg. The remote still resolves, so this looks healthy:
git ls-remote https://github.com/OldOrg/MyRepo.git HEAD   # 200, redirected. Proves nothing.
git push origin main                                       # succeeds -- and deploys nothing.

# Reaching for the worker build config to repoint it does not work either:
# PATCH only accepts `branch` and `production_settings`; it cannot change ownership.
curl -X PATCH ".../accounts/$ACCT/builds/workers/$SCRIPT_TAG" \
  -d '{"git_repository":{"provider_account_name":"NewOrg"}}'   # silently ignored
```

## RIGHT

```bash
# 1. Probe which owner the Cloudflare GitHub App can actually reach (read-only).
#    200 = reachable, 12000 Not found = dead provider account.
for OWNER in 259954353 289261628; do
  curl -s ".../accounts/$ACCT/builds/repos/github/$OWNER/$REPO_ID/config_autofill?branch=main"
done
# NOTE: `branch` is a REQUIRED query param; omitting it returns 12013 Invalid query parameter.

# 2. Repoint the connection. Same repo_id, new provider account.
#    This UPDATES IN PLACE -- the repo_connection_uuid is preserved, so every existing
#    trigger follows automatically and none has to be recreated.
curl -X PUT ".../accounts/$ACCT/builds/repos/connections" \
  -d '{"repo_id":"1332648945","repo_name":"MyRepo","provider_type":"github",
       "provider_account_id":"259954353","provider_account_name":"NewOrg"}'

# 3. Repoint the local remote too (the redirect is not a fix).
git remote set-url origin https://github.com/NewOrg/MyRepo.git

# 4. Verify with a real push, not just config. A build must appear with
#    build_trigger_source=push_event and the NEW provider_account_name.
curl -s ".../accounts/$ACCT/builds/workers/$SCRIPT_TAG/builds?per_page=1"
```

## NOTES

- **Precondition:** the Cloudflare GitHub App must already be installed on the *new* org
  with access to the repo. Step 1's probe is exactly how you confirm that before changing
  anything -- if it 404s under the new owner too, fix the App installation first.
- **`{script_tag}`, not the worker name.** `GET /builds/workers/<script_tag>/builds`
  returns full history including `build_outcome` and
  `build_trigger_metadata.commit_hash`. Passing the worker *name* returns an empty list
  with a `200`, which reads as "no builds ran" and sends you down the wrong path. Get the
  tag from `GET /accounts/{id}/workers/scripts`.
- Manual builds (`POST /builds/triggers/{uuid}/builds`) prove clone+build+deploy but
  **not** the webhook. Only a real push proves push events are arriving again. That
  endpoint also requires `branch` or `commit_hash` in the body -- `{}` returns
  `12002: Invalid request body`.
- A useful audit: compare `provider_account_id` across every build config in the account.
  Connections that share an org should share an id; an odd one out is a stale connection.
- Related: [Workers Builds cannot be created via POST /builds/workers](workers-builds-create-via-triggers.md),
  which covers standing these connections and triggers up in the first place.
