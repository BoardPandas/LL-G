---
tech: claude-code
tags: [skills, frontmatter, disable-model-invocation, yaml, silent-failure]
severity: high
---
# Skill frontmatter key disable-model-invocation uses hyphens, not underscores

## PROBLEM
Claude Code skill frontmatter keys are hyphenated. Writing `disable_model_invocation: true` (underscores) in a SKILL.md is silently ignored: there is no validation error, no warning, and the skill remains fully auto-invocable by the model despite the manual-only intent. The misspelling is easy to make because many config ecosystems (Python, JSON APIs) use snake_case, and nothing tells you the key did not take.

The same trap applies to the other skill frontmatter keys, which are all hyphenated: `argument-hint`, `allowed-tools`, `user-invocable`, `keep-coding-instructions`.

## WRONG
```yaml
---
name: spec-developer
description: Interview-driven spec generation.
user-invocable: true
disable_model_invocation: true
---
```

## RIGHT
```yaml
---
name: spec-developer
description: Interview-driven spec generation.
user-invocable: true
disable-model-invocation: true
---
```

## NOTES
- Verification: after correcting the key, the skill disappears from the model's available-skills list (it can no longer auto-trigger) but stays invocable by the user via `/skillname`. With the underscore key it stays in the list. This was confirmed live: fixing the key in two skills removed both from the model-invocable list mid-session.
- Audit existing repos with: `grep -r "disable_model_invocation" .claude/skills/`. Also check any onboarding docs that teach skill creation; a template repo shipped the wrong spelling in its instructions, propagating the bug to every new skill.
