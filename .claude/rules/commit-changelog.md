---
description: Update changelog and version before committing
globs: ["CHANGELOG.md", "package.json"]
alwaysApply: false
---

# Pre-Commit: Changelog & Version Update

Before every `git commit`, you MUST:

## 1. Update CHANGELOG.md

- Add new entries under `[Unreleased]`. This knowledge base makes no versioned releases:
  do not add a version heading, a tag, or compare links for the version bump below.
- Categorize changes using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections:
  - **Added** — new features or capabilities
  - **Changed** — changes to existing functionality
  - **Deprecated** — features that will be removed
  - **Removed** — removed features
  - **Fixed** — bug fixes
  - **Security** — vulnerability fixes
- Use only those six headings, each once under a `##` heading, in that order. No `### Notes` or dated variants.
- Review staged changes (`git diff --cached`) to determine what changed.
- Write entries from the user's perspective, not implementation details.
- Over 100 KB: move the oldest dated sections into `CHANGELOG-archive.md` (newest first)
  until CHANGELOG.md is under 50 KB, keeping at least the 10 newest there.

## 2. Bump Version in package.json

Version format: **Major.Minor.Patch** (e.g., `1.0.4`). It marks no release: it has no
changelog heading and no tag.

| Segment | When to increment | Resets | Example |
|---|---|---|---|
| **Major** (1st) | Breaking changes — API contract changes, database schema migrations that break compatibility, authentication flow changes, removal of public endpoints | Minor, Patch → 0 | 1.2.3 → 2.0.0 |
| **Minor** (2nd) | New features or enhancements — new pages, new API endpoints, new dashboard widgets, new integrations, new worker jobs | Patch → 0 | 1.2.3 → 1.3.0 |
| **Patch** (3rd) | Everything else — bug fixes, docs, refactors, config changes, chores, any change not covered above | Nothing | 1.2.3 → 1.2.4 |

Rules:
- Every commit bumps at least **Patch**, no exceptions.
- When a higher segment increments, all lower segments reset to 0.
- If a commit includes both a feature and a bug fix, use the **highest** applicable bump (Minor in that case).
- **NEVER bump Major autonomously.** Always ask the user for guidance before incrementing the Major version, even if the changes appear to be breaking. The user decides when a Major bump happens.
- If unsure between Minor and Patch, ask the user.

## 3. Stage Both Files

After updating, stage both files before committing:
```bash
git add CHANGELOG.md package.json
```

## Workflow

1. Run `git diff --cached --stat` to see what's staged
2. Update CHANGELOG.md with appropriate entries
3. Bump version in package.json
4. `git add CHANGELOG.md package.json`
5. Proceed with the commit
