# Plan: Extend KB Section -- Add Contributing Back Instructions

## Context

The `## Knowledge Base` section added to all repos only covers reading from LL-G before
coding. It says nothing about writing back. When Claude discovers a gotcha during
implementation, lessons currently go nowhere (or to local `agent-memory/debugging.md`).
They should go to LL-G so every repo benefits. Additionally, plans lack a required
Lessons Learned / Gotchas section to capture discoveries post-implementation.

---

## Updated Standard Section

Replace the existing `## Knowledge Base` section in all repos with this expanded version:

```markdown
## Knowledge Base

Before writing any script or code, check the LL-G knowledge base for known failure patterns:

1. Fetch the index: https://raw.githubusercontent.com/wellforce-brandon/LL-G/main/llms.txt
2. For each technology you are about to use, fetch its sub-index from the same repo (e.g., `kb/powershell/llms.txt`)
3. Read all HIGH-severity entries for those technologies
4. Read any MEDIUM entry whose title matches your specific task

Technologies covered: PowerShell, Next.js, Tailwind CSS, TypeScript, Graph API, Godot/GDScript, Better Auth, Bash.
Do not load every entry -- use the two-level index.

### Contributing back

Every plan file MUST end with a **Lessons Learned / Gotchas** section. After
implementation, route any new discoveries to LL-G -- not to local agent-memory or
debugging.md files. To add a lesson:

- Preferred: run `/add-lesson` from any session that has `C:\Github\LL-G` in context
- Manual: create `kb/<tech>/<slug>.md`, update `kb/<tech>/llms.txt`, increment the
  entry count in the master `llms.txt`

Lessons stored locally stay local. Lessons in LL-G benefit every repo.
```

---

## Repos to Update

All 26 repos that received the KB section in the previous pass. The find/replace
target is the exact trailing line `Do not load every entry -- use the two-level index.`
-- append the "Contributing back" subsection immediately after it.

### Already have CLAUDE.md (updated in previous pass)

- 60k-mono, AskThem, CC-Notifier, CCHytaleModding, DeafDirectionalHelper, GameDecider,
  MCP, Marketing-Learning, PlexPlaylist, Project-Gitgud, Tasker-Knowledge-Repo,
  Worldbuilder, Zendesk-MCP, bp-website, claude-code-bootstrap, pixel-agents-future,
  relocation, tech-assistant, urban-robot, wellforce-design-system, wellforce-platform

- Shadow-Arena (already had KB section before this task -- verify format and update if needed)

### Newly created CLAUDE.md (created in previous pass)

- TMNT-SF, O365 Claude Scripts, Cleaning-Planner

---

## Special Case: claude-code-bootstrap

Line 97 currently reads:
> Every plan MUST end with a **Learning Lessons / Gotchas** section. After implementation,
> route discoveries to `.claude/agent-memory/debugging.md`.

That routing target conflicts with the new approach. Replace `.claude/agent-memory/debugging.md`
with a reference to LL-G in that line as well.

---

## Critical Files

| File | Action |
|------|--------|
| All 26 repo CLAUDE.mds | Append "Contributing back" subsection to existing KB section |
| `C:\Github\claude-code-bootstrap\CLAUDE.md` | Also fix line 97 routing target |
| `C:\Github\Shadow-Arena\CLAUDE.md` | Verify existing KB section matches new format; update if not |

## Future: Shadow-Arena Godot Pattern Migration

Shadow-Arena has its own self-learning system with `GODOT-GOTCHAS.md` and
`GDSCRIPT-PATTERNS.md` that have accumulated lessons outside LL-G. These should be
reviewed and migrated into `C:\Github\LL-G\kb\godot\` as proper KB entries.
Run as a separate session using `/add-lesson` for each unique finding.

---

## Verification

1. Open any repo session
2. Ask Claude to write a plan for a feature
3. Confirm the plan ends with a Lessons Learned / Gotchas section
4. Confirm any lessons are routed to LL-G, not local files
