---
tech: claude-code
tags: [agent-teams, isolation, worktree, subagents, agent-tool, parallel-agents]
severity: high
---
# Named Agent calls under agent teams ignore the definition's isolation: worktree

## PROBLEM
With `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled, an Agent tool call that carries a `name` launches a **teammate** unless the call itself passes `isolation` (or is a fork). Teammates do not inherit the agent definition's `isolation: worktree` frontmatter. So a skill that dispatches several "isolated" builders by name, relying on the frontmatter, can get parallel agents editing one shared checkout and clobbering each other. Nothing errors: each agent reports success. The `name` is usually added so the agent can be resumed with SendMessage later, which makes this easy to trigger.

## WRONG
```text
Agent({ subagent_type: "builder", name: "issue-283", prompt: "..." })
# builder.md frontmatter has isolation: worktree, but with agent teams on
# this becomes a teammate in the shared checkout
```

## RIGHT
```text
Agent({ subagent_type: "builder", name: "issue-283", isolation: "worktree", prompt: "..." })
# isolation on the call itself keeps it a worktree subagent; resume by name still works
```

## NOTES
Source: code.claude.com/docs/en/agent-teams.md ("Claude launches a teammate when it calls the Agent tool with a name while agent teams are enabled, unless the call is a fork or passes isolation on the call itself"). Verified 2026-10-15 that a builder dispatched with `name` + call-level `isolation: "worktree"`, then resumed with SendMessage, stays in its original worktree with its files intact. Related: worktree-agents-miss-uncommitted-work.md, worktree-agents-branch-from-origin-not-local-head.md.
