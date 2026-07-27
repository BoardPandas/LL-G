---
tech: github-actions
tags: [github-actions, azure, oidc, workload-identity-federation, entra, code-signing, trusted-signing, release-tags, aadsts700213]
severity: high
---
# Adding a tag trigger changes the OIDC subject and breaks Azure signing

## PROBLEM

The OIDC subject claim a workflow presents to Entra is derived from **how the workflow was triggered**, not from the repo or the app registration. Add a trigger and you silently change the identity the job authenticates as.

A `workflow_dispatch` from a branch presents:

```
repo:ORG/REPO:ref:refs/heads/main
```

A tag push presents:

```
repo:ORG/REPO:ref:refs/tags/v1.2.3.4
```

If the app registration only has a federated identity credential for the branch subject, adding `on: push: tags:` breaks `azure/login` with:

```
AADSTS700213: No matching federated identity record found for presented
assertion subject 'repo:ORG/REPO:ref:refs/tags/v1.2.3.4'
```

Entra matches the subject as an **exact, case-sensitive string**. Standard federated credentials support no wildcards, so you cannot pre-register `refs/tags/*` and be done.

Why it is easy to miss:

- Nothing in the repo hints at the dependency. The credential lives in Entra.
- Every local check passes -- YAML validates, the tag glob is correct, the job is unchanged apart from the trigger.
- It only fails on the first real release tag, after the build has already burned several minutes on compile/packaging steps.
- Jobs signing with **secrets** (Apple P12, a PFX in a secret) are unaffected. A multi-platform pipeline therefore fails asymmetrically -- macOS green, Windows red -- which points you at a platform-specific cause instead of the trigger.

Same class of bug for any trigger change that alters the ref: adding `pull_request`, `schedule`, or `release`.

## WRONG

```yaml
# Trigger added. Signing was never reconsidered, so the app registration
# still only trusts repo:ORG/REPO:ref:refs/heads/main
on:
  push:
    tags: ['v*.*.*.*']
  workflow_dispatch:

jobs:
  build:
    runs-on: windows-latest
    permissions:
      id-token: write
      contents: write
    steps:
      - uses: azure/login@v2          # AADSTS700213 on every tag build
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

## RIGHT

```yaml
# Pin the job to a GitHub Environment. The subject becomes
# repo:ORG/REPO:environment:release and stops tracking the ref entirely,
# so tag pushes, dispatches, and any future trigger all present the same
# identity and need only ONE federated credential.
on:
  push:
    tags: ['v*.*.*.*']
  workflow_dispatch:

jobs:
  build:
    runs-on: windows-latest
    environment: release
    permissions:
      id-token: write
      contents: write
    steps:
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

Register one federated identity credential on the app registration:

```
issuer:   https://token.actions.githubusercontent.com
subject:  repo:ORG/REPO:environment:release
audience: api://AzureADTokenExchange
```

Create the GitHub environment with **no protection rules** unless an approval gate on every run is genuinely wanted -- required reviewers will pause each build waiting on a human.

## NOTES

**Nested gotcha -- the environment name in the subject comes from the workflow file, not GitHub's UI.** Creating an environment named `release` can leave GitHub displaying it as `Release`; workflow references resolve case-insensitively, so the job still binds. But Entra subject matching is case-sensitive, so the two could disagree. Verified against a real run: the token carried `...:environment:release` -- the lowercase value written in the workflow's `environment:` key, not the stored display name. Keep the workflow's `environment:` string and the credential subject byte-identical and ignore what settings displays.

**Diagnosing it takes one look.** `azure/login` logs the subject it presented right before failing:

```
Federated token details:
 subject claim - repo:ORG/REPO:ref:refs/tags/v1.2.3.4
```

Compare that string against the app registration's federated credentials before changing anything else. It names exactly what did not match, which distinguishes this from a genuinely missing/expired credential.

**Applies to any `azure/login` OIDC use** -- Trusted Signing, ARM deploys, Key Vault access -- not just code signing.

**Alternative fix:** Entra flexible federated identity credentials support a claims-matching expression that can cover `refs/tags/*` with a wildcard. That avoids touching the workflow but leaves the subject trigger-dependent, so the next trigger change can reintroduce the same failure. The environment approach makes the subject invariant, which is why it is preferred here.

Related: [Azure Trusted Signing action: credentials go in with:, not env:](azure-trusted-signing-credentials.md) -- the other way this same signing pipeline fails auth.
