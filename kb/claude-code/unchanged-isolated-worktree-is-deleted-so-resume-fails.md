---
tech: claude-code
tags: [worktree, isolation, subagents, resume, sendmessage, cleanup, unchanged]
severity: medium
---
# A worktree-isolated subagent's worktree is deleted when it stops without changes, so resuming it fails

## PROBLEM
A subagent with `isolation: worktree` works in its own git worktree. When the agent stops and its worktree has no changes (it only read, ran checks, asked a question, or stopped early), the worktree is removed automatically. A later attempt to continue that agent (for example by messaging it with its ID) points at a directory that no longer exists, and the resume fails instead of continuing.

Only a worktree that contains changes is kept. So "ask the agent a follow-up question about what it just read" works after an agent that edited files and fails after one that did not, which is the opposite of what you would expect.

Observed in one project's builder agents. The exact cleanup rule was not examined beyond this behaviour.

## WRONG
```text
1. Dispatch an isolated agent to investigate; it reports and stops with no edits.
2. Send it a follow-up to resume the same agent.
   -> its worktree is gone; the resume fails.
```

## RIGHT
```text
- Treat an isolated agent that made no changes as finished. Start a fresh agent for the
  follow-up and put the needed findings in its brief.
- For investigation work, use a non-isolated read-only agent type; there is no worktree to lose.
- (Untested) If the agent must be resumable, have it leave a change (a note or a WIP commit)
  so the worktree is kept, and capture its branch name.
- Start every isolated brief with a branch check, because the worktree may not start
  from your current branch:  git merge --ff-only <branch>
```

## NOTES
- Base-commit behaviour is covered separately in `worktree-agents-branch-from-origin-not-local-head.md` and `worktree-agents-miss-uncommitted-work.md`; this entry is only about the lifetime of the worktree.
- Named calls under agent teams have their own isolation rules: see `named-agent-calls-under-teams-ignore-isolation.md`.
