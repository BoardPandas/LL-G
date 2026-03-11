# Claude Code Starter Template -- Instructions

## What This Template Is

This repository provides a pre-configured `.claude/` folder that gives Claude Code a set of skills, agents, and settings aligned with current best practices. It works in two modes:

1. **Clone for new projects** -- Start a new repo with Claude Code already configured.
2. **Copy into existing projects** -- Drop the `.claude/` folder (plus CLAUDE.md and agents.md) into any existing repo to add Claude Code capabilities.

## Folder Structure

```
.claude/
  agents/                  # Custom agent definitions
    architect.md           # Phase-based planning and system design
    reviewer.md            # Code review agent
    security.md            # Security analysis agent
    performance.md         # Performance analysis agent
    explorer.md            # Codebase exploration and research agent
  rules/                   # Conditional instructions (paths: frontmatter)
  skills/                  # Executable skill definitions
    plan-repo/SKILL.md     # Pre-init project planning
    init-repo/SKILL.md     # Repository initialization
    update-practices/SKILL.md  # Best practice updates
    spec-developer/SKILL.md   # Interview-driven feature specs
    code-review/SKILL.md   # Code review
    security-scan/SKILL.md # Security scanning
    performance-review/SKILL.md  # Performance analysis
    dependency-audit/SKILL.md    # Dependency checking
    test-scaffold/SKILL.md      # Test generation
    doc-sync/SKILL.md           # Documentation sync
    mermaid-diagram/SKILL.md    # Diagram generation
  references/
    source-urls.md         # URL registry for fetching best practices
    tools.md               # CLI tools reference (auto-populated per stack)
    design-guardrails.md   # UI/design SLA (generated for frontend projects)
  settings.json            # Project-level Claude Code settings
CLAUDE.md                  # Master project rules for Claude Code
agents.md                  # Agent registry (see agents.md docs below)
instructions.md            # This file
README.md                  # GitHub-facing README
tasks/                     # Saved plans and specs (created on first use)
```

---

## Core Workflow

### 1. Plan → Init → Build → Update

```
plan repo  →  initialize repo  →  build features  →  update practices
```

- **plan-repo** plans the stack, generates README, creates design guardrails and tools reference.
- **init-repo** reads the plan and configures everything.
- **spec-developer** plans individual features.
- **update-practices** keeps the config current.

### 2. Plan in One Session, Execute in Another

For any non-trivial work: plan in one session, then start a fresh session to execute. This keeps context clean and prevents contamination from planning artifacts.

### 3. Phase-Based Planning (Not Timeline-Based)

All planning uses phases, never dates or time estimates:

| Phase | Focus | Exit Criteria |
|-------|-------|---------------|
| Foundation | Project setup, core architecture, tooling | Builds, tests run, deploys |
| Core | Primary features, data models, integrations | All primary flows work E2E |
| Polish | Error handling, edge cases, accessibility | 80%+ coverage, no critical bugs |
| Ship | Deployment, monitoring, documentation | Production-ready |

---

## Skills Reference

### plan-repo

- **Trigger:** "plan repo", "plan project", "plan stack", "recommend stack"
- **What it does:** Interviews you about the project requirements (what it does, target platform, scale, constraints) -- but does NOT ask you to pick a stack. Instead, it spins up parallel research subagents to compare current options (Go vs Rust vs TS, shadcn vs MUI vs Mantine, Drizzle vs Prisma, etc.) as of today's date, then recommends the best stack for your specific project with trade-offs. You approve or override, then it generates README, design guardrails, and tools reference.
- **When to use:** Before init-repo on new projects, or when evaluating a stack change.
- **Output:** Stack recommendation with trade-offs, plan file (`tasks/plan-repo.md`), README draft, design guardrails (if UI), tools reference.
- **Key concept:** It recommends, you decide. Every recommendation is backed by current research, not cached opinions.

### init-repo

- **Trigger:** "initialize repo", "init repo", "set up claude code"
- **What it does:** Reads the plan (if available), detects the stack, fetches best practices, and builds or updates all configuration files. Generates hierarchical CLAUDE.md files and stack-specific design guardrails. Non-destructive merge with existing config.
- **When to use:** After plan-repo, after copying `.claude/` into an existing project, or to rebuild from scratch.
- **Output:** Summary of all files created or modified.

### update-practices

- **Trigger:** "update practices", "refresh best practices", "update claude config"
- **What it does:** Checks today's date, fetches all sources, compares against current config, implements changes. Prunes CLAUDE.md files of stale advice. Updates tools.md and design guardrails.
- **When to use:** Periodically or after Claude Code updates.
- **Safe to repeat:** Running it twice in a row produces no changes the second time.

### spec-developer

- **Trigger:** "spec developer", "plan feature", "spec this feature"
- **What it does:** Explores the codebase with parallel subagents, then asks 20+ clarifying questions about the feature. Generates a 500-700 line implementation plan covering architecture, data models, test plan, error handling, and rollback strategy. Saves to `/tasks`.
- **When to use:** For any feature larger than a single file change.
- **Key concept:** Plan only -- does not implement. Start a fresh session to execute.
- **Variant:** If retrying after a failed implementation, it documents previous attempts to avoid dead ends.

### code-review

- **Trigger:** "code review", "review code", "full code review"
- **What it does:** Scans for correctness, naming, DRY violations, error handling, type safety, test coverage, dead code, TODO/FIXME, and consistency. Severity-ranked report.
- **Scope:** Optionally pass a file or directory path.

### security-scan

- **Trigger:** "security scan", "security audit", "check security"
- **What it does:** Leaked secrets, OWASP Top 10, dependency CVEs, input validation gaps.
- **Scope:** Optionally pass a file or directory path.

### performance-review

- **Trigger:** "performance review", "perf review", "check performance"
- **What it does:** N+1 queries, memory leaks, bundle size, caching, algorithms, build optimization.
- **Scope:** Optionally pass a file or directory path.

### dependency-audit

- **Trigger:** "dependency audit", "audit dependencies", "check deps"
- **What it does:** Outdated packages, known vulnerabilities, unused dependencies across all detected package managers.

### test-scaffold

- **Trigger:** "scaffold tests", "generate tests", "add test coverage"
- **What it does:** Detects test framework, finds untested modules, generates test stubs matching existing patterns.
- **Scope:** Optionally pass a file or directory.

### doc-sync

- **Trigger:** "sync docs", "update docs", "fix documentation"
- **What it does:** Cross-references documentation against code. Finds stale references, incorrect examples, missing docs.

### mermaid-diagram

- **Trigger:** "mermaid diagram", "generate diagram", "visualize data flow"
- **What it does:** Explores the codebase and generates Mermaid diagrams (data flow, architecture, sequence, state machine, ER). Saves to `docs/diagrams/`.
- **When to use:** For debugging user-reported issues without reading code, for documentation, or for understanding complex systems.

---

## Agents Reference

All agents are registered in [agents.md](agents.md) at the repo root. This file serves as the agent registry -- Claude Code reads it to discover available agents.

### architect

- **File:** `.claude/agents/architect.md`
- **Model:** opus
- **Mode:** plan
- **Purpose:** Phase-based planning, tech stack evaluation, file structure design. Always uses phases (Foundation, Core, Polish, Ship), never timelines.

### reviewer

- **File:** `.claude/agents/reviewer.md`
- **Model:** sonnet
- **Mode:** plan
- **Purpose:** Code review for correctness, naming, DRY, error handling, type safety, and standards compliance.

### security

- **File:** `.claude/agents/security.md`
- **Model:** opus
- **Mode:** plan
- **Purpose:** OWASP Top 10, secrets detection, dependency vulnerabilities, input validation.

### performance

- **File:** `.claude/agents/performance.md`
- **Model:** sonnet
- **Mode:** plan
- **Purpose:** Query optimization, memory leaks, I/O, frontend rendering, algorithms, build optimization.

### explorer

- **File:** `.claude/agents/explorer.md`
- **Model:** sonnet
- **Mode:** plan
- **Purpose:** Codebase exploration, online research, doc fetching, context gathering. Always include a "why" when spawning.

---

## Hierarchical CLAUDE.md Architecture

CLAUDE.md files are loaded top-down: root user level → project level → subfolder level. Only relevant files load.

### Rules

1. **Root CLAUDE.md** contains project-wide rules, stack info, global conventions.
2. **Subfolder CLAUDE.md** files only exist where subfolder-specific rules differ from root (e.g., `frontend/CLAUDE.md` for UI conventions).
3. **`.claude/rules/*.md`** files with `paths:` frontmatter provide conditional instructions that only load when working with matching file paths. Use these instead of subfolder CLAUDE.md files for fine-grained scoping.
4. A landing page task never loads your backend CLAUDE.md. Context stays narrow.
5. Keep each file focused and under 200 lines.
6. Prune after every model update -- remove what the model handles natively.
7. Do NOT bloat CLAUDE.md with generic advice the model already knows.

### When to Create Subfolder CLAUDE.md

- The subfolder has a different language or framework than the root
- The subfolder has distinct naming conventions, file structure, or testing patterns
- The subfolder is a separate deployable (e.g., monorepo package)

### When NOT to Create Subfolder CLAUDE.md

- The subfolder follows the same conventions as root
- The rules would just repeat or slightly extend root rules
- The subfolder is a simple utility folder

---

## Subagent Best Practices

### Always Offload to Subagents

- Online research and doc fetching
- Codebase exploration and pattern discovery
- Log analysis and debugging
- Context gathering before implementation

### Always Include a "Why"

Every subagent prompt should explain WHY you need the information:

- **Bad:** "How does auth work?"
- **Good:** "How does auth work, because we're adding rate limiting and need to know where to hook into the auth middleware."

The "why" dramatically reduces noisy and overlapping results from parallel subagents.

### Parallel Exploration

When torn between implementation approaches, spin up parallel Explorer subagents for each approach. Pass all results back to the main session and let it decide.

### Subagents Are Resumable

You can resume a specific subagent to continue its research. Use this to drill deeper without starting over.

---

## Skill Frontmatter

Skills support optional fields for model and invocation control:

```yaml
---
name: my-skill
description: What this skill does
user-invocable: true
disable_model_invocation: true   # Only manual /skillname invocation
model: haiku                      # Which model runs this skill
context: fork                     # Run in isolated subagent context
allowed-tools:
  - Read
  - Glob
---
```

**Model selection guidelines:**
- `haiku` — Well-defined step-by-step skills (localization, release, formatting)
- `sonnet` — Analysis and research skills (code review, exploration)
- `opus` — Orchestration and planning skills (spec developer, architect)

**Additional frontmatter fields (v2.1.69):**
- `context: fork` — Run skill in an isolated subagent, preventing context contamination
- `${CLAUDE_SKILL_DIR}` — Reference the skill's own directory for relative file paths
- Skills in nested `.claude/skills/` subdirectories are auto-discovered

---

## Context Management Tips

### Prevent Context Contamination

- **Plan/execute separation:** Plan in one session, execute in another.
- **Code bias fix:** If Claude is stuck in bad existing patterns, build the feature in isolation in a fresh empty folder, then port it into the main project.
- **`/rewind`:** Instead of arguing with Claude after a wrong turn, rewind to the last good point and re-guide.
- **Document failed attempts:** For stubborn bugs, have Claude write a document of all attempted fixes before starting a new session. The new session loads the document and avoids dead ends.
- **`/handoff`:** Create a handoff document (goal, progress, what worked, what failed, next steps) before ending a session. Load it in the fresh session as sole context.
- **Modularize aggressively:** Files over 500 lines consume massive context. Regularly break them apart.

### Context Window Management

- Keep CLAUDE.md under 200 lines
- Use `/compact` proactively around 50% context (disable auto-compact in `/config` for manual control)
- Start fresh conversations for unrelated topics
- Break tasks small enough to complete in under 50% context usage
- System prompt + tools consume ~10% of context. Enable `ENABLE_TOOL_SEARCH: "true"` in settings to lazy-load MCP tools and save tokens.

---

## Tools Reference

The file `.claude/references/tools.md` lists all CLI tools the project uses. Claude Code reads this before running commands. If a tool is missing, Claude checks tools.md for the install command and offers to install it.

The file is populated by `plan-repo` and `init-repo` based on the detected stack. You can also add entries manually.

---

## Design Guardrails (UI Projects)

For projects with a frontend, `init-repo` generates `.claude/references/design-guardrails.md` with stack-specific UI/design SLA guidelines. These are sourced from current best practices as of the init date and enforced via the CLAUDE.md.

Guardrails cover: component patterns, styling conventions, accessibility requirements, performance budgets, and consistency rules.

---

## Hooks

The template includes hooks in `.claude/settings.json`:

- **PreToolUse (git commit):** Logs a notification when commits are made.
- **Stop:** Bell sound when Claude finishes a task (useful with multiple sessions).
- **Notification:** Bell sound when Claude needs attention.

To add custom hooks, edit `.claude/settings.json`. Supported hook events:

- `PreToolUse` / `PostToolUse` -- Before/after tool execution
- `SessionStart` / `SessionEnd` -- Session lifecycle
- `Stop` / `SubagentStop` -- Task completion
- `Notification` -- System notifications
- `PreCompact` -- Before context compaction
- `UserPromptSubmit` -- Before user prompt processing
- `InstructionsLoaded` -- When CLAUDE.md or `.claude/rules/*.md` files load
- `ConfigChange` -- When configuration files change during session
- `WorktreeCreate` / `WorktreeRemove` -- Git worktree operations
- `PermissionRequest` -- Process permission requests with custom logic
- `TeammateIdle` / `TaskCompleted` -- Agent team events
- `Setup` -- Triggered via `--init`, `--init-only`, or `--maintenance` flags

Hooks also support HTTP mode (POST JSON to URLs) in addition to command mode.

---

## Power User Tips

- **`/add-dir`** — Add a second project directory to copy proven implementations between projects.
- **Verbose mode** (`/config` → verbose → true) — Shows token count and reasoning trace. Read the trace to learn Claude's terminology, then use it in prompts.
- **`/statusline`** — Shows model name, context battery, git branch, unstaged changes. Essential with multiple sessions.
- **`/rewind`** — Return to last good point instead of arguing about a wrong turn.
- **`/fork`** — Branch current session within conversation. Use `--fork-session` with `--continue` to fork from recent sessions.
- **`/handoff`** — Create a summary document before ending a session for seamless continuation.
- **`/release-notes`** — View latest changes in the current Claude Code version.
- **`--worktree` / `-w`** — Start Claude Code in an isolated git worktree for parallel work.
- **`--from-pr`** — Resume sessions linked to a GitHub PR.
- **`claude agents`** — List all configured agents from the CLI.

---

## Customizing for Your Project

### Editing CLAUDE.md

Update root CLAUDE.md with your project's stack, conventions, and standards. Keep under 200 lines. Create subfolder CLAUDE.md files only where distinct rules apply.

### Adding New Skills

1. Create a folder in `.claude/skills/` with your skill name.
2. Create `SKILL.md` inside with YAML frontmatter (`name`, `description`, `user-invocable: true`).
3. Add optional frontmatter: `disable_model_invocation`, `model`, `agent`.
4. Write step-by-step instructions in the markdown body.
5. Update the skill table in CLAUDE.md and this instructions.md file.

### Adding New Agents

1. Create a markdown file in `.claude/agents/` named after the agent.
2. Add YAML frontmatter: `name`, `description`, `model`, and optionally `tools`, `permissionMode`, `maxTurns`, `skills`, `memory`, `isolation`, `background`, `disallowedTools`.
3. Write the agent's role, focus areas, and behavior.
4. Register the agent in [agents.md](agents.md).
5. Update CLAUDE.md.

**New agent fields (v2.1.69):**
- `skills:` — Preload specific skills into the agent for progressive disclosure
- `memory:` — Persistent memory scope (`user`, `project`, or `local`)
- `isolation: worktree` — Run in a temporary git worktree
- `background: true` — Run asynchronously without blocking
- `disallowedTools:` — Remove specific tools from inherited tool lists

### Updating the Source URL Registry

Add URLs to `.claude/references/source-urls.md`. The next `update-practices` run will include them.

### Personal Settings Overrides

Create `.claude/settings.local.json` for personal settings (git-ignored). Overrides `.claude/settings.json`.

---

## Troubleshooting

- **Skill not triggering:** Check `user-invocable: true` in SKILL.md frontmatter.
- **Agent not found:** Ensure the agent file is in `.claude/agents/` and registered in [agents.md](agents.md).
- **Settings not applied:** Hierarchy: CLI flags → settings.local.json → settings.json → global settings.
- **Hooks not running:** Verify hook event name and matcher in settings.json. Run `/doctor`.
- **Stale practices:** Run "update practices" -- it checks today's date and fetches current recommendations.
- **Context overload:** Use `/compact`, break into smaller tasks, or start a fresh session.
