# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **New `agy-execute-plan` Claude Code skill** ("execute plan with antigravity"): hands an existing plan to the Antigravity CLI (`agy`) to implement end-to-end, then independently verifies the result against the plan via the test suite and git diff (never AGY's self-reported log), fixes whatever AGY left incomplete or broke, and reports an honest blocked/partial/complete status. Encodes the verified agy v1.0.8 operating details: run headless with empty stdin + `--dangerously-skip-permissions` or it hangs, redirected stdout is empty so judge by diff and tests, plus the Windows PATH reload and the `AGY_BLOCKED.md` halt signal.
- New Prisma technology in the KB with its first gotcha (HIGH): an index created via raw SQL in a migration but not declared in schema.prisma is treated as drift, and every later `prisma migrate dev` silently emits `DROP INDEX` into unrelated migrations. Declare the index with `@@index(..., type: Gin, map: "name")` so Prisma owns it, and restore an already-shipped drop with a follow-up `CREATE INDEX IF NOT EXISTS` migration.
- **New `merge-worktrees` Claude Code skill** ("merge worktrees"): merges every open git worktree and local branch into the main branch, pushes, then removes the worktrees and force-deletes the merged branches (locally and, with confirmation, on the remote). It detects the real main branch, confirms a plan before any merge, commits pending worktree work first, merges with `--no-ff`, and treats merge conflicts and non-fast-forward pulls as hard stops; nothing is deleted until the merge is committed and pushed.

### Changed
- Repointed LL-G and BP knowledge-base references from the `wellforce-brandon` GitHub org to `BoardPandas` after both repos moved (fetch URLs, `gh api` paths, and raw content links)
