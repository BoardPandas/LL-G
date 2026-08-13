---
tech: github-actions
tags: [oidc, azure, entra, federated-identity, code-signing, org-transfer, rename, AADSTS700213]
severity: high
---
# Transferring a repo to another org breaks OIDC even after you update the org name

## PROBLEM

Move a repository between GitHub organisations and every Azure/AWS/GCP federated credential stops matching. The obvious fix — update the credential's subject to the new org name — **does not work**, and that is what makes this expensive.

GitHub switches transferred repositories to **immutable subject claims**: numeric organisation and repository IDs embedded in the subject.

```
before:  repo:OldOrg/my-repo:environment:release
after:   repo:NewOrg@259954353/my-repo@1038750424:environment:release
                   ^^^^^^^^^^        ^^^^^^^^^^^
```

The IDs exist for a good reason — they stop somebody claiming an abandoned org name and inheriting whatever cloud trust it had — but nothing announces the change, and the credential you carefully rewrote as `repo:NewOrg/my-repo:environment:release` still never matches.

Entra's response is identical whether the credential is absent, misspelled, or correct-but-plain-named:

```
AADSTS700213: No matching federated identity record found for presented assertion subject
'repo:NewOrg@259954353/my-repo@1038750424:environment:release'
```

So the trap has three parts, and the middle one is what costs the time:

1. Nothing fails at transfer time. The next tag build fails, possibly days later, and looks unrelated to the move.
2. **A correct-looking fix appears to be already in place.** Someone reads the error, adds the new-org credential, and it still fails — with the same message. The credential list now *contains* the new org name, so the obvious hypothesis is eliminated and attention goes elsewhere.
3. The error text contains the answer. The presented subject is printed in full, `@`-IDs and all, and it is easy to read past as noise.

The blast radius is everything OIDC-authenticated: code signing, artifact publishing, deploys, cloud logins. Where only some jobs use OIDC, a partial release ships — a macOS package publishes while the signed Windows installer does not, so a release exists and looks complete.

## WRONG

```jsonc
// The credential updated after the transfer. Reads correctly, never matches.
{
  "name": "github-actions-release-env",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:NewOrg/my-repo:environment:release",
  "audiences": ["api://AzureADTokenExchange"]
}
```

## RIGHT

```jsonc
// Copy the subject verbatim out of the failing run's error, @-IDs included.
{
  "name": "github-actions-release-env-immutable",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:NewOrg@259954353/my-repo@1038750424:environment:release",
  "audiences": ["api://AzureADTokenExchange"]
}
```

Add it with the Graph API, or in Entra under App registration -> Certificates & secrets -> Federated credentials:

```bash
az ad app federated-credential create --id "$APP_OBJECT_ID" --parameters '{
  "name": "github-actions-release-env-immutable",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:NewOrg@259954353/my-repo@1038750424:environment:release",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Then **re-run the failed job rather than re-tagging** — the credential is what changed, not the commit.

## NOTES

- **Read the presented subject from the error and paste it exactly.** Do not reconstruct it from what you believe the org and repo are called; that is the step that produced the credential which does not work. The numeric IDs are stable, so this is a one-time correction.
- **Entra subject matching is case-sensitive**, and GitHub stores an environment with the casing it was created with. If you have both `:environment:release` and `:environment:Release` credentials for the old subject, you need both for the immutable one too.
- **Allow ~15 minutes for propagation** before re-running, or the retry fails on a credential that exists but is not live yet — and that failure is the same AADSTS700213, which makes it look like the fix was wrong.
- **Leave the old credentials in place** until the first green run. They are additive and match nothing; removing them at the same time as adding the new one means a failure cannot tell you which change was wrong. Prune afterwards.
- **The same error has an unrelated common cause**: adding a tag trigger changes the subject from `ref:refs/heads/main` to `ref:refs/tags/*`. See [Adding a tag trigger changes the OIDC subject and breaks Azure signing](tag-trigger-breaks-azure-oidc.md). Check whether the presented subject contains `@`-IDs to tell the two apart immediately.
- Not Azure-specific. AWS `sts:AssumeRoleWithWebIdentity` trust policies and GCP Workload Identity Federation match the same subject string and break identically.
- Also fires on a plain **org rename**, not only a transfer between orgs.
