---
tech: claude-code
tags: [subagents, isolation, worktree, multi-repo]
severity: medium
---
# A worktree-isolated agent type refuses git operations on any checkout but its own, so it cannot do multi-repo work

## PROBLEM
An agent whose definition sets `isolation: worktree` (such as a `builder` type) is refused any git command against another checkout, with "a worktree-isolated agent's git operations must target its own worktree".
Briefing it to edit and commit in other repos' checkouts fails at its first `git -C`. A well-behaved agent then stops instead of working around the block, so parallel multi-repo fan-outs come back empty.

## WRONG
```text
Agent(subagent_type: "builder", prompt: "commit in C:/scratch/org/<repo>")
```

## RIGHT
```text
Agent(subagent_type: "general-purpose", prompt: "work directly in C:/scratch/org/<repo> with git -C; you are not isolated")
```

## NOTES
Check an agent type's isolation before fanning out across repos. Related: worktree-agents-miss-uncommitted-work.
