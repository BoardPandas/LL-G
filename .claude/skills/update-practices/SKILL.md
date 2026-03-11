---
name: update-practices
description: Fetch latest Claude Code best practices and update the .claude/ folder configuration. Safe to run repeatedly.
user-invocable: true
argument-hint: (no arguments needed)
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - WebFetch
  - WebSearch
  - Agent
---

# Update Best Practices

You have been asked to update this repository's Claude Code configuration to the latest best practices. Follow these steps exactly.

## Important: Date Awareness

Check the current date FIRST. All best practices must be verified as current as of today's date. Do not rely on cached knowledge -- use WebSearch to confirm that recommended versions, tools, and patterns are still current.

## Step 1: Read Current Configuration

1. Read `.claude/references/source-urls.md` to get the list of URLs to fetch.
2. Read `CLAUDE.md` in the repo root. Note its contents and version references.
3. Read `agents.md` in the repo root. Note registered agents.
4. Scan `.claude/skills/` using Glob. List all existing skills.
5. Scan `.claude/agents/` using Glob. List all existing agents.
6. Read `.claude/settings.json`. Note current settings.
7. Read `.claude/references/tools.md` (if it exists). Note current tools.
8. Read `.claude/references/design-guardrails.md` (if it exists). Note current guardrails.
9. Scan `.claude/rules/` using Glob. List all existing path-scoped rules.
10. Scan `.claude/agent-memory/` using Glob. List all existing memory files.

## Step 2: Fetch Latest Practices

Spin up parallel Explore subagents to fetch and analyze sources:

1. **Official sources subagent:** "Fetch all official Anthropic sources from the source URL registry. Extract: current Claude Code version, new features, deprecated features, new recommended settings/skills/agents/hooks, folder structure changes, new frontmatter fields for agents and skills, new hook events, new settings options. WHY: We need to know what changed officially to update the config accurately."

2. **Community sources subagent:** "Fetch all community sources from the source URL registry. Extract: new practical patterns, updated skill examples, agent configurations, workflow improvements, path-scoped rule patterns, agent memory patterns, HTTP hook patterns. WHY: Community sources capture battle-tested patterns ahead of official docs."

3. **Stack freshness subagent:** "Check the project's detected stack (from CLAUDE.md or dependency manifests) against current versions and best practices as of today's date. WHY: We need to ensure tools.md and design guardrails reflect the latest stable versions."

Wait for all subagents, then proceed.

## Step 3: Compare and Identify Changes

Categorize findings as:

- **NEW:** Features or patterns not yet reflected in the current config.
- **UPDATED:** Patterns that exist but need modification to match current best practices.
- **DEPRECATED:** Patterns in use that are no longer recommended.
- **CURRENT:** Patterns that already match best practices (no action needed).

Check each of these areas explicitly:

### Core files
- Skills (all template skills present and current)
- Agents (all template agents present and current)
- Settings (permissions, hooks, env)
- Tools reference
- Design guardrails

### Path-scoped rules (.claude/rules/*.md)
- Are existing rules still valid for the current stack?
- Are there new path patterns that should have rules (e.g., new source directories added)?
- Do rule frontmatter `paths:` patterns still match the actual file structure?
- Are there new best-practice rule templates from official/community sources?

### Agent memory (.claude/agent-memory/)
- Does the directory exist? If not, it should be created.
- Are the standard files present (README.md, patterns.md, decisions.md, debugging.md)?
- Is the README still accurate about conventions?
- Have any memory entries become stale or contradicted by current code?
- Does `debugging.md` have the standard gotchas structure? If empty or unstructured, initialize with the template from init-repo.

### Agent frontmatter
Review each agent for new frontmatter fields:
- `background` — Should any agents run in the background?
- `isolation` — Should security agent use isolation?
- `context` — Should any agents have injected context?
- `skills` — Should any agents be bound to specific skills?
- `memory` — Should any agents read agent-memory files on startup?

### Skill frontmatter
Review each skill for new frontmatter fields:
- `context: fork` — Should any skills run in isolated context?
- `agent` — Should any skills be bound to a specific agent?
- Are `model` assignments still optimal?

### Hook events
- Are all recommended hooks configured?
- Are there new hook events available that should be adopted?
- Are any configured hooks using deprecated event names or syntax?
- Should HTTP hooks be added for team workflows?
- Are matchers using the correct syntax?

Available hook events (18 as of v2.1.70 -- check for new ones in fetched sources):
SessionStart, SessionEnd, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
PermissionRequest, SubagentStart, SubagentStop, Stop, Notification, PreCompact,
TeammateIdle, TaskCompleted, InstructionsLoaded, ConfigChange, WorktreeCreate, WorktreeRemove

Hook types: command, http, prompt, agent

### Settings
Check for new or updated settings:
- `attribution.commit` / `attribution.pr` — commit/PR attribution
- `autoUpdatesChannel` — stable or preview update channel
- `sandbox.permissions` / `sandbox.network` — sandbox configuration
- `language` — response language
- `allowedHttpHookUrls` — HTTP hook URL allowlist
- `alwaysThinkingEnabled` — extended thinking
- `disableAllHooks` — hook kill switch (for settings.local.json)

Also check if any new settings have been introduced in the latest Claude Code version.

## Step 4: Implement Changes

For each NEW or UPDATED item:

1. Determine which file(s) need to change.
2. Make the change. Follow the non-destructive merge rules:
   - Never remove custom project-specific content.
   - Append new sections rather than replacing existing ones.
   - For JSON files, deep-merge -- preserve existing keys.
   - For agent-memory files, never overwrite -- only add missing files.
   - For rules, preserve existing rules -- only add new ones or update paths.
3. For DEPRECATED items: update the pattern to the recommended alternative.

Ensure these skills still exist and are current:
- plan-repo, init-repo, update-practices
- spec-developer, code-review, security-scan
- performance-review, dependency-audit, test-scaffold
- doc-sync, mermaid-diagram

Ensure these agents still exist and are current:
- architect, reviewer, security, performance, explorer

Update `.claude/references/tools.md` if any tools have new versions or new tools should be added.

Update `.claude/references/design-guardrails.md` if UI best practices have changed.

Review skill frontmatter and update `model`, `disable-model-invocation`, `context`, and `agent` fields if recommendations have changed.

Review agent frontmatter and update `background`, `isolation`, `context`, `skills`, and `memory` fields if recommendations have changed.

Review hook configuration:
- Verify all hook events are still valid.
- Add new recommended hooks.
- Update matchers if file paths have changed.
- Add HTTP hooks if `allowedHttpHookUrls` is configured and team webhooks are in use.

Review settings:
- Check `attribution`, `autoUpdatesChannel`, `sandbox`, `language`, `allowedHttpHookUrls`, `alwaysThinkingEnabled` against best practices.
- Ensure `settings.local.json.example` exists if it should.

## Step 5: Prune CLAUDE.md Files

Review all CLAUDE.md files in the hierarchy. Remove:
- Advice the model now handles natively (check against current model capabilities)
- Outdated version references
- Redundant rules that duplicate parent CLAUDE.md content

Keep each CLAUDE.md focused and under 200 lines.

## Step 6: Prune and Validate Rules

Review `.claude/rules/*.md` files:
- Remove rules that duplicate CLAUDE.md content (rules should be path-specific, not general).
- Verify `paths:` patterns still match actual files in the project.
- Update rules if stack conventions have changed.
- Remove rules for deleted source directories.

## Step 7: Update Documentation

1. Update `CLAUDE.md` if skill or agent inventory changed.
2. Update `agents.md` if agent inventory changed.
3. Update `instructions.md` if usage patterns, available features, or configuration options changed. Ensure it documents:
   - Path-scoped rules (`.claude/rules/*.md`)
   - Agent memory (`.claude/agent-memory/`)
   - All agent and skill frontmatter fields
   - All hook events and types (command, http, prompt, agent)
   - All settings options including settings.local.json overrides

## Step 8: Report

Print a diff-style summary:

```
CHANGES APPLIED:
  [NEW] Added skill: <name> -- <reason>
  [NEW] Added rule: <path> -- <scope description>
  [NEW] Added agent-memory file: <path> -- <purpose>
  [NEW] Added hook: <event>/<matcher> -- <reason>
  [NEW] Added setting: <key> -- <value> -- <reason>
  [UPDATED] Modified .claude/settings.json -- <what changed>
  [UPDATED] Modified agent <name> frontmatter -- <fields added/changed>
  [UPDATED] Modified skill <name> frontmatter -- <fields added/changed>
  [UPDATED] Modified rule <path> -- <what changed>
  [DEPRECATED] Replaced <old pattern> with <new pattern> in <file>
  [CURRENT] No changes needed for: <list>
  [PRUNED] Removed from <file>: <what was removed and why>

FEATURES IN USE:
  - Path-scoped rules: <count> rules in .claude/rules/
  - Agent memory: <count> files in .claude/agent-memory/
  - Hook events: <list of configured events>
  - Hook types: <command|http|prompt>
  - Advanced agent frontmatter: <agents using background/isolation/context/skills/memory>
  - Advanced skill frontmatter: <skills using context/agent>
  - Settings: <list of configured optional settings>

FEATURES AVAILABLE BUT NOT CONFIGURED:
  <list any features that could be enabled but aren't, with instructions>

CLAUDE CODE VERSION: <version found>
CURRENT DATE: <today's date>
SOURCES CHECKED: <count> of <total> fetched successfully
```

## Idempotency

Running this skill twice in a row must produce no changes the second time. Every change must be conditional -- only apply if the current state differs from the target state.
