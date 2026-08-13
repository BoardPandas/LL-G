---
tech: cloudflare
tags: [workers, workers-builds, ci-cd, api, wrangler, monorepo, git-integration]
severity: medium
---
# Workers Builds cannot be created via POST /builds/workers -- use connections + triggers

## PROBLEM

To wire Workers Builds (git-push auto-deploy) from the API rather than the dashboard, the
obvious endpoint is `POST /accounts/{account_id}/builds/workers` -- "Create worker build
configuration" in Cloudflare's own OpenAPI spec, complete with a full example payload.

It rejects everything with `12002: Invalid request body`, including Cloudflare's verbatim
documented example. The error carries no field-level detail, so there is nothing to correct;
you burn attempts permuting the payload (string vs numeric `repo_id`, empty vs null
`build_command`, with and without `environment_variables`) and every one fails identically.

`POST /builds/workers` appears to be read-model-only in practice. The `GET` on
`/accounts/{account_id}/builds/workers/{script_tag}` works fine and returns exactly the shape
the POST claims to accept, which makes the dead end look like a payload bug rather than a
wrong endpoint.

Creation actually happens in two steps against two different endpoints: register the
repository connection, then create one trigger per Worker referencing it. Note that
`environment_variables` is not part of the trigger body -- it is a separate PATCH.

## WRONG

```js
// POST /accounts/{account_id}/builds/workers
// -> 12002: Invalid request body (even with Cloudflare's own example payload)
await cloudflare.request({
  method: 'POST',
  path: `/accounts/${accountId}/builds/workers`,
  body: {
    script_tag: '0284ccf95ab34c7f8dfff22d70adc431',
    git_repository: {
      provider_type: 'github',
      provider_account_id: '289261628',
      provider_account_name: 'My-Org',
      repo_id: '1332648945',
      repo_name: 'my-repo',
      branch: 'main',
    },
    production_settings: {
      build_command: 'npm run build',
      deploy_command: 'npx wrangler deploy',
      build_token_uuid: '<uuid>',
      root_directory: '/',
    },
  },
});
```

## RIGHT

```js
// 1. Register the repository connection -> returns repo_connection_uuid.
//    Requires the "Cloudflare Workers and Pages" GitHub App to already be installed on the
//    org (browser OAuth flow -- there is no API for the install itself).
const conn = await cloudflare.request({
  method: 'PUT',
  path: `/accounts/${accountId}/builds/repos/connections`,
  body: {
    provider_type: 'github',
    provider_account_id: '289261628',   // GitHub numeric owner id
    provider_account_name: 'My-Org',
    repo_id: '1332648945',              // GitHub numeric repo id
    repo_name: 'my-repo',
  },
});

// 2. One trigger per Worker. ALL listed fields are required -- including the empty arrays
//    and an empty-string build_command if you have no build step.
await cloudflare.request({
  method: 'POST',
  path: `/accounts/${accountId}/builds/triggers`,
  body: {
    external_script_id: '0284ccf95ab34c7f8dfff22d70adc431', // the script TAG, not its name
    repo_connection_uuid: conn.result.repo_connection_uuid,
    build_token_uuid: '<uuid>',        // reuse one from GET /accounts/{id}/builds/tokens
    trigger_name: 'Production',
    build_command: '',
    deploy_command: 'npx wrangler deploy',
    root_directory: 'apps/my-worker',  // monorepo: per-Worker subdirectory
    branch_includes: ['main'],
    branch_excludes: [],
    path_includes: ['apps/my-worker/*', 'packages/*', 'pnpm-lock.yaml'],
    path_excludes: [],
    build_caching_enabled: true,
  },
});

// 3. Build-time env vars are a SEPARATE call -- not a field on the trigger.
await cloudflare.request({
  method: 'PATCH',
  path: `/accounts/${accountId}/builds/triggers/${triggerUuid}/environment_variables`,
  body: { NODE_VERSION: { is_secret: false, value: '24' } },
});
```

## NOTES

- `external_script_id` is the script **tag** (a 32-char hex id), not the Worker name. Get it
  from `GET /accounts/{id}/workers/services/{name}` at
  `result.default_environment.script.tag`. Passing the name fails the same opaque way.
- Verify afterwards with `GET /accounts/{id}/builds/workers/{script_tag}`; before any trigger
  exists it returns `12040: No build configuration associated with that script tag`.
- `GET /accounts/{id}/builds/repos/{provider}/{owner_id}/{repo_id}/config_autofill?branch=main`
  is a useful pre-flight: `12000: Not found` means Cloudflare cannot see a wrangler config at
  that `root_directory` on that branch -- usually the GitHub App is not installed on that org,
  or (easy to miss) the code simply is not on the target branch yet.
- Monorepos: Cloudflare runs the install from `root_directory`, not the repo root. For a pnpm
  workspace that may need a build command of `cd ../.. && pnpm install --frozen-lockfile`.
- Build watch paths use `*` as "zero or more characters"; Cloudflare's own monorepo example is
  `project-a/*, packages/*`, so `apps/x/*` does match nested files.
- Related: [block-ai-bots-breaks-mcp-connector.md](block-ai-bots-breaks-mcp-connector.md) for
  another Cloudflare failure that surfaces with no useful error surface.
