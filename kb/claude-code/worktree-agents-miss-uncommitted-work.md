---
tech: claude-code
tags: [subagents, worktree, isolation, git, uncommitted-changes, stale-tree, agent-frontmatter]
severity: high
---
# Worktree-isolated subagents never see your uncommitted work

## PROBLEM

An agent definition can set `isolation: worktree` in its frontmatter. When it does, every spawned instance runs in a **fresh git worktree branched from a commit** -- not in your working tree. If you are holding uncommitted changes, the agent cannot see them. It reads the last committed state of every file.

This fails silently and convincingly. The agent does real work, runs real commands, and reports confident, internally-consistent results -- about the wrong content. Nothing errors.

The trap is worse when the task is "bring these files into compliance," because the pre-change state often already *is* compliant. A fleet of agents will each report "already done, nothing to fix" and be telling the truth about their own tree.

Concrete failure: 8 builders were dispatched to split 42 files that a repo-wide reformat had pushed over a 500-line cap. The reformat was uncommitted. Every worktree was branched from a commit predating it, so in each agent's tree those files were still their original size and already under the cap. The first agent reported `discover.js` at **429 lines** -- exactly its committed size. The working tree had **504**. That one-number mismatch was the only signal anything was wrong; without it, eight agents' worth of "verified compliant" reports would have been accepted.

Note this is the *complement* of the shared-tree hazard: agents that share one working tree can clobber your uncommitted edits, so the usual advice is "isolate in a worktree." Isolation solves that and creates this. Both directions bite.

## WRONG

```bash
# Working tree has 948 uncommitted files.
git status --porcelain | wc -l    # 948

# Spawn agents whose definition contains `isolation: worktree`.
#   -> each gets a clean checkout of HEAD (or some other commit)
#   -> none of them can see any of the 948 changes
# Agent reports: "All 5 assigned files are already under the cap; no changes needed."
# True in its worktree. False in yours. No error anywhere.

git worktree list
# /repo                                    1cb95566 [main]        <- your dirty tree
# /repo/.claude/worktrees/agent-<id>       f4365734 [wt-agent]    <- what the agent actually saw
```

## RIGHT

```bash
# 1. Know whether the agent type isolates, BEFORE dispatching work.
grep -n 'isolation' .claude/agents/*.md
# builder.md:  isolation: worktree      <- will NOT see uncommitted changes

# 2. Either commit first so the worktree branches from your state...
git add -A && git commit -m "wip: baseline for agent fan-out"

# 3. ...or dispatch a non-isolated agent type that edits the real tree.

# 4. Either way, put a self-check at the TOP of every agent brief so a
#    wrong-tree dispatch fails loudly on the agent's first action:
#
#      Run `git rev-parse --show-toplevel`. It MUST print /abs/path/to/repo,
#      NOT a path under .claude/worktrees/. Then run `wc -l` on your assigned
#      files and confirm each matches the count below. If the toplevel is a
#      worktree OR any line count does not match, STOP and report that you are
#      in the wrong tree. Do not edit anything.
#
#    Handing agents expected line counts (or hashes) turns a silent
#    wrong-content run into an immediate, unambiguous abort.
```

## NOTES

- Detection heuristic: if an agent reports a file metric that exactly matches `git show HEAD:<file>` rather than the working tree, it is in a stale checkout. Compare with `git show HEAD:<f> | wc -l` vs `wc -l < <f>`.
- Isolated agents' edits land on their own branch, not in your tree, so even a *correct* run needs a merge step. If you want edits applied in place, do not use an isolating agent type.
- Killing the agents leaves the worktrees behind. Clean up with `git worktree remove --force <path>` then `git worktree prune`; the branches survive removal.
- Verify the isolation setting per agent type, not once. Built-in general-purpose agents typically do not isolate; a project-defined `builder`/`implementer` may.
- Related: the `kb/git` entry on concurrent agents sharing one working tree reverting your uncommitted edits -- the opposite failure mode of the same underlying question ("which tree is this agent actually in?").
