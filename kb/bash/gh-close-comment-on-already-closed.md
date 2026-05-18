---
tech: bash
tags: [gh-cli, github, batch-operations, silent-failure, audit-trail]
severity: medium
---
# gh issue close --comment silently drops the comment on already-closed issues

## PROBLEM

`gh issue close <num> --comment "..."` silently drops the `--comment` body if the issue is already closed. The CLI exits 0 and only prints `! Issue ... is already closed`. Any script batch-closing issues with close notes will lose audit-trail comments on every issue that was already closed, without any error to react to. Easy to miss because the exit code is fine and the legitimate close-and-comment cases on still-open issues work normally.

## WRONG

```bash
# Batch-closing six issues, two of which were already closed.
# The two already-closed issues exit 0 but lose their comments — the
# audit trail (commit hashes, fix descriptions) never lands on those tickets.
for n in 34 41 35 32 31 33; do
  gh issue close "$n" --comment "Fixed by abc1234 (1.2.3.4). ..."
done
```

## RIGHT

```bash
# Post the comment FIRST (works whether open or closed), then close.
# `gh issue comment` succeeds on closed issues too, so no info is lost.
for n in 34 41 35 32 31 33; do
  gh issue comment "$n" --body "Fixed by abc1234 (1.2.3.4). ..."
  gh issue close "$n" 2>/dev/null  # ignore "already closed"
done
```

Or, defensively, check state first:

```bash
state=$(gh issue view "$n" --json state --jq .state)
if [ "$state" = "OPEN" ]; then
  gh issue close "$n" --comment "..."
else
  gh issue comment "$n" --body "..."
fi
```

## NOTES

- Concrete failure (2026-05-18, vigilis): closed six issues in a cleanup pass. Two (#34, #32) had been closed earlier the same day by another contributor. `gh issue close --comment` reported `! Issue ... is already closed` and exit 0 for both. The four still-open issues attached their notes normally; the two already-closed ones did not. Required a follow-up `gh issue comment` pass to restore the audit trail. Spotted only because the user asked "do these have notes in GitHub issues?" — invisible to any exit-code-based check.
- Comment-first ordering is the safer default: `gh issue comment` works on both open and closed issues, so the body always lands. Closing afterward is idempotent.
- Affects `gh` CLI as of versions current through late 2026. No `--force-comment` or similar override exists.
