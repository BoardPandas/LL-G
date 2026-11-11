# Codex configuration (generated)

Everything here, plus the root `AGENTS.md` and `.agents/` (skills + Antigravity config), is generated from
the Claude Code configuration by `scripts/sync-codex.mjs`. Edit the Claude source, never these files, then run:

```bash
npm run sync:codex
npm run check:claude   # fails if any generated file is stale, missing, or unexpected
```

| Claude Code source | Codex output |
|---|---|
| `CLAUDE.md`, `.claude/rules/*.md`, permission deny rules | `AGENTS.md` |
| `.claude/skills/<name>/**` | `.agents/skills/<name>/**`; `agents/openai.yaml` for explicit-only skills |
| `.claude/agents/<name>.md` | `.codex/agents/<name>.toml` |
| `.claude/settings.json` hooks | `.codex/hooks.json` (runs `.claude/scripts/` in place) |

Current output: 17 skills, 7 agents, 2 Codex hook handlers (2 Antigravity), AGENTS.md 8134 B.

## How the mapping works

- **Models.** Claude tiers map to Codex tiers: `opus` -> `gpt-6-sol`, `sonnet` -> `gpt-6-luna`, `haiku` -> `gpt-6-luna`.
- **Sandbox.** Agents whose Claude tool list cannot write or run commands get `sandbox_mode = "read-only"`. The rest inherit the session's sandbox.
- **Hooks.** Codex has no handler-level `if`, so every mirrored script filters its own input (via `_git-commit-filter.sh`). Paths are anchored at the git root, with a cwd-relative `commandWindows` fallback.
- **Edit hooks.** Codex edits files with `apply_patch` (`tool_input.command`), so `Edit|Write` hooks mirror only once a script parses `apply_patch`. (Antigravity mirrors them in `.agents/hooks.json` via `_antigravity-hook.sh`.)
- **Trust.** Codex loads `.codex/` only for trusted projects after hook approval in `/hooks`.

## Not carried over

- Stop/Notification terminal bell -- replaced by [tui] notifications in .codex/config.toml.
