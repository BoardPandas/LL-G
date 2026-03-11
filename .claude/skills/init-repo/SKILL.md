---
name: init-repo
description: Build or rebuild the .claude/ folder with best practices. Use when setting up Claude Code in a new or existing repository. Run plan-repo first for new projects.
user-invocable: true
argument-hint: (no arguments needed)
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - WebFetch
  - WebSearch
  - Agent
---

# Initialize Repository for Claude Code

You have been asked to initialize or upgrade this repository's Claude Code configuration. Follow these steps exactly.

## Important: Date Awareness

Before fetching any best practices, check the current date. All recommendations must reflect best practices as of today's date -- not cached knowledge. Use WebSearch to verify current versions.

## Step 1: Read Plan (if exists)

1. Check if `tasks/plan-repo.md` exists. If it does, read it and use it as the basis for all decisions below. The plan contains the chosen stack, file structure, design guardrails, and tools.
2. If no plan exists, that is fine -- proceed with auto-detection.

## Step 2: Read Current State

1. Read `CLAUDE.md` in the repo root (if it exists). Note its contents.
2. Read `agents.md` in the repo root (if it exists). Note its contents.
3. Read `README.md` in the repo root (if it exists). Identify the project's tech stack, purpose, and conventions.
4. Scan the `.claude/` folder (if it exists) using Glob. List all existing files.
5. Read `.claude/settings.json` (if it exists). Note current settings.
6. Check for existing `.claude/rules/*.md` files. Note any path-scoped rules already defined.
7. Check for existing `.claude/agent-memory/` directory. Note any shared knowledge files.

## Step 3: Fetch Best Practices

1. Read the source URL registry at `.claude/references/source-urls.md`.
2. Spin up parallel Explore subagents to fetch and analyze sources:
   - **Subagent 1:** "Fetch official Anthropic sources and extract current Claude Code version, features, and recommended patterns. WHY: We need the latest official conventions to generate an up-to-date config."
   - **Subagent 2:** "Fetch community sources and extract practical tips, skill patterns, and agent patterns. WHY: Community sources have battle-tested patterns not in official docs."
3. For URLs that fail to fetch, log the failure and continue. Do not halt.

## Step 4: Detect Stack and Generate Design Guardrails

1. Identify the tech stack from dependency manifests, file types, and the plan (if available).
2. Use WebSearch to find current best practices (as of today's date) for the detected stack:
   - Coding conventions and naming patterns
   - Project structure conventions
   - UI/design patterns (if the project has a frontend)
   - Testing patterns
3. If the project has a UI, generate `.claude/references/design-guardrails.md` with stack-specific UI/design SLA guidelines. Include:
   - Component size limits and composition patterns
   - Styling conventions for the chosen approach
   - Accessibility requirements (WCAG level, required ARIA patterns)
   - Performance budgets (bundle size, image optimization, lazy loading)

## Step 5: Analyze Gaps

Compare the current `.claude/` folder against the best practices you fetched. Identify:

- Missing configuration files (settings.json, agents, skills)
- Outdated patterns or deprecated features in use
- Skills that should exist but do not
- Agent definitions that are missing or incomplete
- Settings that should be updated
- Missing tools.md entries for detected stack tools
- Missing `.claude/rules/*.md` files for path-scoped conventions
- Missing `.claude/agent-memory/` directory for team knowledge

## Step 6: Build or Update

For each gap identified, create or update the file. Follow these rules:

- **Non-destructive:** Never overwrite custom project-specific settings. Merge with existing config.
- **Skills:** Ensure all template skills exist in `.claude/skills/`. If additional skills are relevant to the detected tech stack, add them.
- **Agents:** Ensure all template agents exist in `.claude/agents/`. Add others if relevant.
- **Settings:** Update `.claude/settings.json` with recommended permissions and hooks. Preserve existing custom entries.
- **Tools reference:** Update `.claude/references/tools.md` with stack-specific CLI tools, install commands, and usage patterns. **Important:** There is no local Docker, no local Postgres, no local Redis -- all infrastructure runs remotely on Northflank and Cloudflare. Do not add local infrastructure tools (docker, docker-compose, psql, redis-cli). Preserve the existing **Available MCP Servers** section that documents all MCP integrations available to Claude Code.
- **CLAUDE.md:** Build a hierarchical CLAUDE.md structure:
  - Update root `CLAUDE.md` with project-specific stack info, conventions, and skill/agent inventory.
  - Plan (but do not create) subfolder CLAUDE.md files where distinct rules will apply.
  - Keep each CLAUDE.md file focused and under 200 lines.
  - Include in the Planning section: "Every plan MUST end with a Learning Lessons / Gotchas section. After implementation, route discoveries to `.claude/agent-memory/debugging.md`."
- **agents.md:** Update the root agents.md to register all agents. Preserve project-specific content.
- **README.md:** If a README exists, add or update the "Claude Code" section. Do not alter other sections.

## Step 7: Configure Path-Scoped Rules

Create `.claude/rules/` directory with conditional instruction files. Each rule file uses `paths:` frontmatter to load only when working with matching file patterns.

### How rules work
- Files in `.claude/rules/*.md` have YAML frontmatter with a `paths:` array of glob patterns.
- A rule file only loads into context when Claude is working with files matching those patterns.
- This keeps context lean -- backend rules don't load for frontend work and vice versa.

### Rules to create based on detected stack

For every project, create:
- `.claude/rules/tests.md` — Testing conventions, paths: `["**/test/**", "**/*.test.*", "**/*.spec.*", "**/__tests__/**"]`

For frontend projects, also create:
- `.claude/rules/frontend.md` — Component patterns, styling rules, accessibility. Paths matching frontend source dirs.
- `.claude/rules/styles.md` — CSS/styling conventions. Paths matching style files.

For backend/API projects, also create:
- `.claude/rules/api.md` — API conventions, error handling, auth patterns. Paths matching API source dirs.
- `.claude/rules/database.md` — Migration rules, query patterns, ORM conventions. Paths matching schema/migration files.

For monorepos, create rules scoped to each package/app.

### Example rule file format
```markdown
---
paths:
  - "src/components/**"
  - "src/ui/**"
---

# Component Rules

- Max 200 lines per component file. Split large components into composition.
- Always export a single default component per file.
- Use semantic HTML elements over generic divs.
```

## Step 8: Initialize Agent Memory

Create `.claude/agent-memory/` as a version-controlled team-shared knowledge base.

### Purpose
Agent memory is evolving knowledge that agents accumulate during work. Unlike CLAUDE.md (static rules), agent memory captures discovered patterns, debugging insights, and project-specific knowledge that emerges over time.

### Structure to create
- `.claude/agent-memory/README.md` — Explains the purpose and conventions for this directory.
- `.claude/agent-memory/patterns.md` — Discovered code patterns and conventions (starts nearly empty).
- `.claude/agent-memory/decisions.md` — Key technical decisions and their rationale (starts nearly empty).
- `.claude/agent-memory/debugging.md` — Known gotchas and learning lessons. Initialize with this structure:

  ```markdown
  # Gotchas & Learning Lessons

  Reference this file before starting work. Add entries when you discover non-obvious behavior, surprising failures, or patterns that wasted time. Don't make the same mistakes twice.

  ## Format

  ### [Number]. [Short descriptive title]

  **Context:** When/where this occurs.
  **Problem:** What goes wrong.
  **Solution:** What to do instead.
  **Why:** Brief explanation of root cause.

  ---

  *Keep entries concise and actionable. Remove entries that no longer apply.*
  ```

### README content guidelines
The README should explain:
- Files are version-controlled and shared across the team.
- Agents should read relevant memory files before starting work.
- Agents should update memory files when they discover new patterns or make decisions.
- Keep entries concise. Remove outdated entries. No session-specific information.
- Memory files complement CLAUDE.md — CLAUDE.md has rules, agent-memory has discovered knowledge.

## Step 9: Add Skill Frontmatter Optimizations

For each skill, consider adding:
- `disable-model-invocation: true` for skills that should only be manually invoked
- `model: haiku` for well-defined step-by-step skills that do not require heavy reasoning
- `model: sonnet` for analysis and research skills
- `model: opus` for orchestration and planning skills
- `context: fork` for skills that should run in isolated subagent context (prevents context contamination in the main session). Good for: analysis skills that produce large output, research skills that fetch many URLs, any skill that shouldn't pollute the main conversation.
- `agent: <agent-name>` to bind a skill to a specific agent that should execute it. Useful when a skill requires the specialized persona and tools of a particular agent.

## Step 10: Add Agent Frontmatter Optimizations

For each agent, consider adding these frontmatter fields beyond the basics (name, description, model, permissionMode, tools):

- `background: true` — Agent runs in the background without blocking the main session. Good for: long-running analysis, monitoring, continuous review tasks.
- `isolation: worktree` — Agent runs in a temporary git worktree (isolated copy of repo). Worktree is auto-cleaned if no changes; if changes are made, the worktree path and branch are returned. Good for: implementer agents, parallel feature work, security analysis.
- `context: <instructions>` — Additional context injected into the agent's system prompt. Use for agent-specific rules that don't belong in the main CLAUDE.md.
- `skills: [skill1, skill2]` — List of skills this agent can invoke. Restricts which skills are available to the agent.
- `maxTurns: N` — Maximum agentic iterations. Use for budget control (e.g., `maxTurns: 20` on implementer agents).
- `memory: user|project|local` — Persistent cross-session memory scope. `user` = `~/.claude/agent-memory/` (cross-project), `project` = `.claude/agent-memory/` (team-shared), `local` = `.claude/agent-memory-local/` (personal, git-ignored). First 200 lines of MEMORY.md are injected into the agent's system prompt on startup.

### Recommended agent enhancements

- **security** agent: Consider `isolation: worktree` to prevent analyzed code from influencing the agent's behavior.
- **reviewer** agent: Consider `memory: agent-memory/patterns.md` so it reviews against discovered project patterns.
- **explorer** agent: Consider `background: true` for long research tasks that shouldn't block the main session.
- **architect** agent: Consider `skills: [plan-repo, spec-developer]` to give it access to planning skills.

Only add these fields when they provide clear value for the project. Do not add them speculatively.

## Step 11: Configure Hooks

### Available hook events (18)

Beyond the 3 currently configured (PreToolUse, Stop, Notification), these hook events are available:

| Event | Fires When | Use Cases |
|-------|-----------|-----------|
| **SessionStart** | When a new session begins | Welcome message, status check, re-inject context after compaction (matcher: `compact`) |
| **SessionEnd** | When a session ends | Save state, create handoff doc |
| **UserPromptSubmit** | When user submits a prompt | Input validation, prompt logging |
| **PreToolUse** | Before any tool call | Validate tool args, block dangerous commands, log activity |
| **PostToolUse** | After any tool call completes | Post-processing, validation of results, auto-lint |
| **PostToolUseFailure** | When a tool call fails | Error logging, fallback actions, retry logic |
| **PermissionRequest** | When a tool requests permission | Auto-approve safe reads, log permission decisions |
| **SubagentStart** | When a subagent launches | Log subagent activity, resource tracking |
| **SubagentStop** | When a subagent completes | Aggregate results, trigger follow-up tasks |
| **Stop** | When Claude finishes a response | Notification sounds, auto-formatting, status updates |
| **Notification** | When Claude sends a notification | Alert sounds, desktop notifications, webhook pings |
| **PreCompact** | Before context compaction (matcher: `manual` or `auto`) | Save important state, create summaries |
| **TeammateIdle** | When a teammate agent is idle | Coordination, load balancing |
| **TaskCompleted** | When a background task completes | Status updates, follow-up actions |
| **InstructionsLoaded** | When a CLAUDE.md or rules file loads | Audit logging, rule tracking |
| **ConfigChange** | When settings or skill files change | Audit logging, reload triggers |
| **WorktreeCreate** | When an isolated worktree is created | Setup worktree-specific config |
| **WorktreeRemove** | When a worktree is cleaned up | Cleanup, merge results |

### Hook types

1. **Command hooks** (current): `{ "type": "command", "command": "..." }` — Runs a shell command. Exit code 0 = allow, 2 = block (PreToolUse), non-zero = error.
2. **HTTP hooks**: `{ "type": "http", "url": "https://..." }` — Sends an HTTP POST to a URL. The request body contains the event payload. Requires the URL to be listed in `settings.json` under `allowedHttpHookUrls`.
3. **Prompt hooks**: `{ "type": "prompt", "prompt": "..." }` — Single-turn LLM judgment (yes/no decision). Useful for validation gates.
4. **Agent hooks**: `{ "type": "agent", "prompt": "..." }` — Multi-turn subagent with tool access. Useful for complex validation or post-processing.

### Hooks to configure based on project needs

**Always configure:**
- `PreToolUse` with `Bash(git commit*)` matcher — validation before commits
- `Stop` — notification sound
- `Notification` — notification sound

**Recommended for active development:**
- `PostToolUse` with `Write(*)` or `Edit(*)` matcher — auto-lint after file changes (if linter is configured)
- `PreToolUse` with `Bash(rm -rf*)` matcher — block dangerous delete commands
- `SubagentStop` — notification when long-running subagents complete

**Recommended for team projects using HTTP hooks:**
- `Stop` with HTTP hook — ping team webhook (Slack, Discord) when Claude finishes a task
- `Error` with HTTP hook — send error reports to monitoring

**Ask the user** which additional hooks they want before configuring beyond the defaults.

### Matcher syntax
- `Bash(pattern)` — matches Bash tool calls where the command matches the glob pattern
- `Write(pattern)` — matches Write tool calls where the file path matches
- `Edit(pattern)` — matches Edit tool calls where the file path matches
- `Read(pattern)` — matches Read tool calls where the file path matches
- No matcher = fires for all tool calls of that event type

## Step 12: Configure Settings

Update `.claude/settings.json` with all relevant settings. Deep-merge with existing.

### Core settings (always configure)
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": { "allow": [...], "deny": [...] },
  "env": { ... },
  "plansDirectory": "tasks",
  "hooks": { ... }
}
```

### Optional settings to evaluate and configure

| Setting | Purpose | When to enable |
|---------|---------|---------------|
| `attribution.commit` | Add "Generated by Claude Code" to commit messages | Team projects for audit trail |
| `attribution.pr` | Add Claude attribution to PR descriptions | Team projects for transparency |
| `autoUpdatesChannel` | `"stable"` or `"preview"` for Claude Code updates | `"stable"` for production repos, `"preview"` for template/experimental repos |
| `sandbox.permissions` | Sandboxed execution permissions for tools | When running untrusted code analysis |
| `sandbox.network` | Network access restrictions in sandbox | Security-sensitive projects |
| `language` | Preferred response language (e.g., `"en"`, `"ja"`) | Non-English teams |
| `allowedHttpHookUrls` | Allowlist of URLs for HTTP hooks | When using HTTP hooks for webhooks |
| `alwaysThinkingEnabled` | Always use extended thinking | Complex codebases that benefit from deeper reasoning |
| `disableAllHooks` | Kill switch for all hooks | For `settings.local.json` — lets individuals disable hooks locally |

### settings.json vs settings.local.json

- **`.claude/settings.json`** — Version-controlled, shared team settings. Put everything the team agrees on here.
- **`.claude/settings.local.json`** — Git-ignored, personal overrides. Document this in instructions.md so developers know they can create it.

Recommend creating a `.claude/settings.local.json.example` file showing common personal overrides:
```json
{
  "disableAllHooks": false,
  "alwaysThinkingEnabled": true,
  "language": "en"
}
```

**Ask the user** about attribution, language, and autoUpdatesChannel preferences before setting them. Configure the rest based on project analysis.

## Step 13: Create instructions.md

Create or update `instructions.md` in the repo root with:

- What the `.claude/` folder contains
- How to use each skill (trigger phrase and description)
- Hierarchical CLAUDE.md architecture explanation
- Path-scoped rules explanation (`.claude/rules/*.md`)
- Agent memory explanation (`.claude/agent-memory/`)
- Agent and skill frontmatter fields reference
- Hook events reference (all available events, types, matcher syntax)
- Settings reference (settings.json vs settings.local.json, all available settings)
- Subagent usage best practices
- Phase-based planning workflow
- Context management tips
- How to customize the setup for this specific project
- How to add new skills, agents, rules, or memory files

## Step 14: Report

Print a summary listing:

- Files created (with paths)
- Files updated (with what changed)
- Skills available (with model assignments and frontmatter)
- Agents registered (with frontmatter enhancements)
- Path-scoped rules created
- Agent memory initialized
- Hooks configured (events, matchers, types)
- Settings configured (highlighting opt-in features)
- Hierarchical CLAUDE.md plan
- Tools detected and added to tools.md
- Design guardrails generated (if applicable)
- Any warnings or issues encountered
- Features available but not yet configured (with instructions to enable later)

## Non-Destructive Merge Rules

When merging with existing configuration:

1. For JSON files: deep-merge objects. Existing keys are preserved unless the new value is strictly better.
2. For markdown files: append new sections. Do not remove existing sections.
3. For skills: if a skill already exists with custom content, do not overwrite. Only update if the existing skill references deprecated features.
4. For agents: same rule as skills.
5. For rules: if a rule file already exists, preserve it. Only add new rule files.
6. For agent-memory: never overwrite existing memory files. Only create missing ones.
