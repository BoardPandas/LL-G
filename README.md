# LL-G: Lessons Learned & Gotchas

A shared knowledge base of coding gotchas, failure patterns, and lessons learned. Consumed by Claude Code sessions across all projects to avoid repeating known mistakes.

**This repo is Claude-optimized, not human-readable.** Structure and formatting are designed for fast machine scanning, not visual presentation.

## Covered Technologies

- PowerShell
- Next.js
- Tailwind CSS
- TypeScript

## How It Works

Each project's `CLAUDE.md` points here. Before scripting, Claude reads `llms.txt` (the master index), loads the relevant technology index, and pulls in specific gotcha entries. New lessons are added via `/add-lesson` from any repo session.

## Adding Entries

Run `/add-lesson` in any Claude Code session. See `CLAUDE.md` for the manual process.
