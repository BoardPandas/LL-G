---
tech: claude-code
tags: [rules, frontmatter, paths, globs, alwaysApply, cursor, mdc, context-window, silent-failure]
severity: high
---
# Cursor .mdc frontmatter keys in .claude/rules invert scoping instead of failing

## PROBLEM
Claude Code scopes a `.claude/rules/*.md` file with a `paths:` key. Cursor's `.mdc` rule format uses `globs:` and `alwaysApply:` instead. Those keys are not recognised, and unrecognised frontmatter does not error -- the file is simply treated as unscoped, which means it loads in EVERY session.

So `alwaysApply: false` produces the exact opposite of what it says. A rule written to be conditional becomes permanently resident, and its full token cost is charged to every unrelated session.

This is easy to acquire without noticing: teams migrating from Cursor, or copying a rules template, or an LLM generating rules from memory of the `.mdc` format. In one repo, 9 of 15 rule files loaded unconditionally for this reason, including a 36 KB Magic-rules appendix that was present during Docker and CSS work. Total always-on context was ~21.7k tokens before the user typed anything, so the genuinely relevant rules competed with a wall of undifferentiated MANDATORY text.

The second failure mode is quieter still: a rule with a correct `paths:` key whose globs match zero files never fires at all, and looks identical to a rule that simply hasn't been triggered yet.

## WRONG
```markdown
---
description: Check the knowledge base before writing code
globs: ["src/**", "lib/**", "app/**"]
alwaysApply: false
---
```
Result: `globs` and `alwaysApply` are ignored, so this loads in every session forever.
(`lib/` and `app/` also may not exist -- a dead glob is a rule that never fires.)

## RIGHT
```markdown
---
paths:
  - "src/**"
  - "dashboard/src/**"
  - "proxy-pipeline/src/**"
---
```
For a rule that genuinely should always load, omit frontmatter entirely -- that is what unconditional loading looks like on purpose, rather than by accident.

## NOTES
- Verify by inspection, not intent: list the files appearing under `Contents of <path>` headers in the model's own context. That is ground truth for what loaded. A rule you believe is scoped may be sitting in every prompt.
- Assert both properties in CI. `paths:` present, and every glob matching at least one real file. Both failures are silent and neither surfaces at runtime.
- Budget the always-on total in bytes or tokens. Unscoped rules are a per-turn tax on every session forever, and they accrete without anyone deciding to add them. Related: `line-budgets-gamed-by-long-lines.md`.
- Salience is not additive. When six always-on files all assert MANDATORY, none of them is salient; the fix is scoping and mechanical gates, not stronger wording.
