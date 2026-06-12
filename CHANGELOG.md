# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- New Prisma technology in the KB with its first gotcha (HIGH): an index created via raw SQL in a migration but not declared in schema.prisma is treated as drift, and every later `prisma migrate dev` silently emits `DROP INDEX` into unrelated migrations. Declare the index with `@@index(..., type: Gin, map: "name")` so Prisma owns it, and restore an already-shipped drop with a follow-up `CREATE INDEX IF NOT EXISTS` migration.
- **New `merge-worktrees` Claude Code skill** ("merge worktrees"): merges every open git worktree and local branch into the main branch, pushes, then removes the worktrees and force-deletes the merged branches (locally and, with confirmation, on the remote). It detects the real main branch, confirms a plan before any merge, commits pending worktree work first, merges with `--no-ff`, and treats merge conflicts and non-fast-forward pulls as hard stops; nothing is deleted until the merge is committed and pushed.

### Changed
- Repointed LL-G and BP knowledge-base references from the `wellforce-brandon` GitHub org to `BoardPandas` after both repos moved (fetch URLs, `gh api` paths, and raw content links)
