---
tech: github-actions
tags: [reusable-workflow, workflow-call, repository-visibility, internal-repository]
severity: high
---
# A public repo cannot call a reusable workflow in an internal repo

## PROBLEM
A public repository cannot call a reusable workflow (`on: workflow_call`) stored in an internal or private repository, whatever that repository's Actions access setting says. The setting "Accessible from repositories in the organization" shares internal workflows only with other internal and private repositories. A plan that has public knowledge-base repos call `org/internal-repo/.github/workflows/sync.yml@<sha>` cannot work, and nothing says so until a caller workflow runs and fails to resolve the called workflow.

## WRONG
```yaml
# In the PUBLIC repo BoardPandas/LL-G
jobs:
  sync:
    uses: BoardPandas/Roundtable/.github/workflows/kb-sync.yml@<sha>  # Roundtable is internal
    secrets: inherit
```

## RIGHT
```yaml
# In the INTERNAL repo: it reads the public repos itself, on a schedule and on demand.
on:
  schedule: [{ cron: "*/15 * * * *" }]
  workflow_dispatch:
jobs:
  sync:
    steps:
      - uses: actions/checkout@<sha>          # the internal repo's own scripts
      - uses: actions/checkout@<sha>
        with: { repository: BoardPandas/LL-G, ref: main, path: kb-source }  # public: default token reads it
```

## NOTES
- Check visibility first: `gh repo view <org>/<repo> --json visibility` for the caller and the called repo, and `gh api repos/<org>/<repo>/actions/permissions/access` for the internal one.
- Inverting the direction keeps the credentials in the internal repo's environment instead of in public repos' secrets; gate the scheduled job on a green CI run for the exact commit, since a schedule runs main's tip.
- Found building Roundtable's KB sync (plan P4, 2026-10-17).
