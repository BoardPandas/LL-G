# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Added the missing template skills** `add-practice`, `apply-practice`, and `ux-review` (with its `.claude/references/ux-laws.md` reference) from `claude-code-bootstrap`, completing the canonical skill set. The bodies are the current canonical versions (custom `explorer` agent, normalized `model:`/`effort:` frontmatter; the KB-write skills use `.claude/scripts/kb-upsert.sh`).
- **New `agy-execute-plan` Claude Code skill** ("execute plan with antigravity"): hands an existing plan to the Antigravity CLI (`agy`) to implement end-to-end, then independently verifies the result against the plan via the test suite and git diff (never AGY's self-reported log), fixes whatever AGY left incomplete or broke, and reports an honest blocked/partial/complete status. Encodes the verified agy v1.0.8 operating details: run headless with empty stdin + `--dangerously-skip-permissions` or it hangs, redirected stdout is empty so judge by diff and tests, plus the Windows PATH reload and the `AGY_BLOCKED.md` halt signal.
- New Prisma technology in the KB with its first gotcha (HIGH): an index created via raw SQL in a migration but not declared in schema.prisma is treated as drift, and every later `prisma migrate dev` silently emits `DROP INDEX` into unrelated migrations. Declare the index with `@@index(..., type: Gin, map: "name")` so Prisma owns it, and restore an already-shipped drop with a follow-up `CREATE INDEX IF NOT EXISTS` migration.
- **New `merge-worktrees` Claude Code skill** ("merge worktrees"): merges every open git worktree and local branch into the main branch, pushes, then removes the worktrees and force-deletes the merged branches (locally and, with confirmation, on the remote). It detects the real main branch, confirms a plan before any merge, commits pending worktree work first, merges with `--no-ff`, and treats merge conflicts and non-fast-forward pulls as hard stops; nothing is deleted until the merge is committed and pushed.

### Changed
- Repointed LL-G and BP knowledge-base references from the `wellforce-brandon` GitHub org to `BoardPandas` after both repos moved (fetch URLs, `gh api` paths, and raw content links)
- **Synced `.claude/references/hooks-and-settings.md` to Claude Code 2.1.201** from the claude-code-bootstrap template: hook structured output (updatedToolOutput, additionalContext, reloadSkills/sessionTitle), Tool(param:value) parameter matching, HTTP hook custom headers with env-var interpolation, the PermissionRequest auto-approval pattern, new settings (defaultMode rename, fallbackModel, enforceAvailableModels, disableBundledSkills, requiresMinimumVersion), the full six-tier settings precedence chain, and the ENABLE_PROMPT_CACHING_1H cache lever.

## [2026-06-14]

### Added
- `.claude/references/hooks-and-settings.md`: canonical hook-events table, hook types (command, http, prompt, agent, mcp_tool), matcher syntax, and settings catalog in a single reference file; `init-repo` and `update-practices` now point here instead of duplicating the tables inline.
- `.claude/scripts/kb-upsert.sh`: portable shell helper used by `add-lesson` to create or update files in a GitHub repo via the contents API without requiring the GNU-only `base64 -w0` flag or manual SHA capture.
- `.gitattributes`: `*.sh text eol=lf` rule so shell scripts are checked out with LF line endings on all platforms, preventing `bad interpreter: bash\r` errors.

### Changed
- Propagated template skill fixes from `claude-code-bootstrap`:
  - All skills that referenced the built-in `Explore` subagent type now use the custom `explorer` agent (the built-in loads every MCP tool schema and blows the context window).
  - `init-repo`: added Steps 3a/3b (BP + LL-G knowledge-base integration), Step 7 new rules (`bp-check.md`, `llg-check.md`), Step 11 now delegates to `hooks-and-settings.md`, added Steps 13-15 (instructions.md, report, BP verification). Added `model: opus`, `effort: high` frontmatter.
  - `update-practices`: added Step 2b (bootstrap template sync with TEMPLATE-NEW/UPDATED/REWRITTEN categorization), updated hooks section to point to `hooks-and-settings.md`, added cost/token efficiency audit, expanded Step 8 report format. Added `model: opus`, `effort: high` frontmatter.
  - `plan-repo`: corrected fixed-infrastructure description (frontend deploys to Northflank container, not Cloudflare Pages). Added `model: opus`, `effort: high` frontmatter.
  - `doc-sync`: replaced the old lightweight audit-only skill with the full TOC-driven wiki system (three modes: init/update/audit; AUTOGEN markers; evidence-based citations; Mermaid validation; `explorer` subagents for parallel page generation). Added `model: sonnet`, `effort: medium` frontmatter.
  - `mermaid-diagram`: fixed `disable_model_invocation` (underscore) to `disable-model-invocation` (hyphen); added `model: sonnet`, `effort: low` frontmatter.
  - `spec-developer`: fixed `disable_model_invocation` to `disable-model-invocation`; added `model: opus`, `effort: high` frontmatter.
  - `dependency-audit`: added `model: sonnet`, `effort: medium` frontmatter.
  - `performance-review`: replaced deprecated `- Task` tool with no task tool (scan uses Read/Glob/Grep); added `effort: medium` frontmatter.
  - `security-scan`: replaced deprecated `- Task` tool; added `effort: high` frontmatter.
  - `test-scaffold`: replaced deprecated `- Task` tool with `- Agent`; added `model: sonnet`, `effort: medium` frontmatter.
