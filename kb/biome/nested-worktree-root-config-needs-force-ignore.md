---
tech: biome
tags: [biome, configuration, nested-config, git-worktree, files-includes, force-ignore, monorepo, claude-code]
severity: medium
---
# A nested worktree aborts `biome check` with "nested root configuration" even outside a whitelist `files.includes`

## PROBLEM
Biome 2 discovers configuration files by walking the whole project tree. A git worktree inside the repo
(for example an agent worktree at `.claude/worktrees/<name>`) is a full checkout with its own `biome.json`,
so `biome check .` aborts the entire run:

```
× Found a nested root configuration, but there's already a root configuration.
× Biome exited because the configuration resulted in errors. Please fix them.
```

This happens even when the root `files.includes` is a whitelist (`src/**`, `tests/**`, ...) that never names
`.claude/`. Being left out of the whitelist does not stop config discovery. A CI gate such as
`pnpm check` (lint first) therefore fails in the main checkout whenever any agent worktree exists, and it
passes again once they are removed, so the failure looks intermittent.

## WRONG
```jsonc
// biome.json -- whitelist only; .claude/worktrees/*/biome.json is still discovered
{
  "files": {
    "includes": ["src/**", "tests/**", "*.config.ts"]
  }
}
```

## RIGHT
```jsonc
// biome.json -- force-ignore (!!) keeps the scanner out of the folder entirely
{
  "files": {
    "includes": ["src/**", "tests/**", "*.config.ts", "!!.claude/worktrees"]
  }
}
```
```gitignore
# .gitignore -- also stops worktrees showing as untracked
.claude/worktrees/
```

## NOTES
- The Biome docs recommend `!!` for "build output and nested projects that Biome should not inspect".
  A single `!` happened to work on 2.5.15, but the docs say a `!` path may still be indexed, so don't rely on it.
- `.gitignore` plus `vcs: { enabled: true, clientKind: "git", useIgnoreFile: true }` also fixed it on 2.5.15.
  It hands every future gitignore entry to Biome, though, which can silently narrow what gets checked. Prefer `!!`.
- Verified on Biome 2.5.15 by planting a nested worktree with failing canary files. Before the fix: the config error.
  After: the same 103 files were checked and the canaries were ignored.
- Other tools did not need a change because their globs are rooted:
  - tsc: explicit tsconfig `include`s;
  - Vitest: includes `tests/unit/**`, `tests/worker/**`;
  - `node --test "scripts/**/*.test.mjs"`.
  A bare `**` glob would pick up worktree copies, so check before assuming.
- Source: BoardPandas/fandom 5ae6dea (v0.5.6).
