---
tech: claude-code
tags: [agents, subagents, refactoring, style-rules, code-review, diff]
severity: medium
---
# Agent prompt style rules do not govern verbatim code moves

## PROBLEM
A style rule in a subagent's prompt (for example "never use em dashes or double dashes in anything you write") governs prose and code the agent authors, not text it relocates. In a mechanical refactor or doc gap-fill, agents copy existing lines verbatim, and any rule violations in the source text travel with the copy into new files and new diff lines. Four parallel agents with the explicit no-em-dash instruction still produced 12 added lines containing em dashes, because the dashes came from the text they were told to move faithfully. The two instructions ("move verbatim" and "never write X") conflict, and verbatim wins.

## WRONG
```text
Agent prompt: "Never use em dashes in anything you write."
... then trusting the output without checking, because the rule was stated.
```

## RIGHT
```bash
# After any agent-driven refactor or doc move, lint the ADDED lines of the diff,
# not the prompt. Pre-existing violations in unchanged lines are not yours; added ones are.
git diff | grep -E "^\+[^+]" | grep -c $'\u2014'   # em dashes entering the codebase
```
Then fix only the added lines (keeps the change additive and the diff clean).

## NOTES
Generalizes to any style rule vs. copied content: banned words, comment formats, quote styles, line endings. The reliable enforcement point is a diff check on `+` lines in the orchestrating session (or CI), not prompt instructions to the copying agent.
