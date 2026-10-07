---
tech: architecture
tags: [requirements, integrations, notifications, webhooks, chat, assumptions, verification, dead-code, git-history]
severity: medium
---
# A deleted integration leaves a believable ghost: verify the mechanism, not the observed effect

## PROBLEM

A request references existing behaviour: "send this app's feedback to the same
chat channel the other app's feedback goes to." The reasonable belief is that the
other app posts to the channel from its own code, so the plan is to copy that code
and its webhook secret.

But the other app's posting code, its webhook env var, and the secret were deleted
months earlier. The messages kept arriving because a platform-level integration
produces the same visible effect: the chat tool's source-control app is subscribed
to the repository and announces every new issue the app files.

A behaviour that survives its own code's deletion is indistinguishable from one
that did not, right up until someone tries to copy it. Copying the remembered
mechanism means resurrecting a deleted code path (duplicate messages, a secret
that no longer exists) when the real mechanism needs no code at all.

## WRONG

```text
Request:    "Post feedback to the same channel the other app uses."
Assumption: the other app posts from code
Plan:       add CHAT_WEBHOOK_URL + postToChannel(), copied from memory of the other app
```

## RIGHT

```bash
# Trace the mechanism in the other repo before copying it.
grep -rn 'WEBHOOK_URL\|hooks\.' other-app/src            # does code still post?
git -C other-app log --oneline -S 'WEBHOOK_URL'          # when was it added / removed?
grep -n -i 'webhook' other-app/CHANGELOG.md              # was the removal announced?
# Then check integrations that live OUTSIDE the code: the chat tool's
# repo subscriptions, repository webhooks, automation services.
gh api repos/OWNER/REPO/hooks --jq '.[].config.url'
```

## NOTES

- Applies to any "do what X does" request: scheduled jobs, emails, exports,
  syncs. Find where the effect is produced today, not where it was produced when
  you last looked.
- The observed effect is the weakest evidence available, because several
  mechanisms can produce it and only one of them is in the code.
