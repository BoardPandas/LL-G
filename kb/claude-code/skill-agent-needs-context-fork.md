---
tech: claude-code
tags: [skills, frontmatter, agent, context-fork, model, wiring-guard]
severity: high
---
# A skill's agent: field does nothing without context: fork

## PROBLEM
The skills doc defines `agent` as "Which subagent type to use when `context: fork` is
set." Without `context: fork` the field is ignored: the skill runs inline on whatever
model the session is using, and the agent's model, tools and system prompt never apply.
No warning. Two review skills shipped this way from a bootstrap template, and the repo's
wiring guard counted `agent:` alone as "binds a model", so the guard certified the defect
instead of catching it.

## WRONG
```yaml
---
name: repo-review
agent: reviewer
allowed-tools: [Read, Glob, Grep]
---
```

## RIGHT
```yaml
---
name: repo-review
context: fork
agent: reviewer
allowed-tools: [Read, Glob, Grep]
---
```

## NOTES
- Forked skills run in the background by default since 2.1.218; add `background: false`
  if the caller needs the result in the foreground.
- Alternative when the skill should stay inline: declare `model:` directly (without fork,
  it applies for the current turn).
- Guard: fail any SKILL.md whose frontmatter has `agent:` and no `context: fork`, and do
  not let `agent:` satisfy a "skill resolves to a model" check on its own.
